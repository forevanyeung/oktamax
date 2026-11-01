/**
 * Runs Okta's MCP server (okta/okta-mcp-server) once per admin.
 *
 * Okta's server is single-user: it reads one access token from the OS keyring
 * and decides its tool list from OKTA_SCOPES at startup. To host it for many
 * admins, each admin gets their own process with:
 *
 *   - its own HOME (nothing shared on disk between admins),
 *   - a keyring backend (`python/oktamax_keyring.py`) that reads the admin's
 *     token from a file we rewrite before every request – so it always uses the
 *     caller's current token, and never runs its own sign-in,
 *   - OKTA_SCOPES limited to the read scopes the token actually has, so Okta's
 *     server drops its write tools at startup,
 *   - only the environment it needs (no AWS credentials or other server secrets).
 *
 * Processes are reused across requests and closed after `idleMs` without use.
 * To answer the first question quickly, `warmUp` runs Okta's server once at
 * startup (so `uvx` has downloaded it), and `prepare` starts an admin's process
 * when they open the chat, before they ask anything.
 */
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { Principal } from '../auth';

export interface ProcessPoolOptions {
  /** Command that starts okta-mcp-server over stdio, e.g. `uvx okta-mcp-server@1.1.7`. */
  command: string;
  args: string[];
  oktaOrgUrl: string;
  oktaClientId: string;
  /** Scopes the Okta server may be started with; anything else in a token is ignored. */
  allowedScopes: readonly string[];
  /** Directory containing `oktamax_keyring.py`. */
  keyringModuleDir: string;
  idleMs?: number;
  maxProcesses?: number;
  /** Extra environment for the child (e.g. a shared UV_CACHE_DIR). */
  env?: Record<string, string>;
}

interface Session {
  client: Promise<Client>;
  transport: StdioClientTransport;
  home: string;
  tokenFile: string;
  scopes: string;
  lastUsed: number;
  inFlight: number;
}

export class OktaMcpProcessPool {
  private sessions = new Map<string, Session>();
  private root: Promise<string>;
  private reaper: ReturnType<typeof setInterval>;

  constructor(private readonly options: ProcessPoolOptions) {
    this.root = mkdtemp(join(tmpdir(), 'oktamax-mcp-'));
    this.reaper = setInterval(() => void this.closeIdle(), 30_000);
    this.reaper.unref();
  }

  /**
   * An MCP client connected to this admin's own Okta MCP server, with the
   * admin's current token in place. Callers must call `release` when done.
   */
  async acquire(principal: Principal): Promise<{ client: Client; release: () => void }> {
    const scopes = principal.scopes.filter((s) => this.options.allowedScopes.includes(s));
    const scopeList = scopes.sort().join(' ');

    let session = this.sessions.get(principal.userId);
    // Okta's server fixes its tool list at startup, so a scope change needs a fresh process.
    if (session && session.scopes !== scopeList) {
      await this.close(principal.userId);
      session = undefined;
    }
    if (session) {
      await writeToken(session.tokenFile, principal.token);
    } else {
      await this.makeRoom();
      session = await this.start(principal.userId, scopeList, principal.token);
    }

    session.lastUsed = Date.now();
    session.inFlight++;
    const current = session;
    try {
      return {
        client: await current.client,
        release: () => {
          current.inFlight--;
          current.lastUsed = Date.now();
        },
      };
    } catch (error) {
      current.inFlight--;
      await this.close(principal.userId);
      throw error;
    }
  }

  /** Starts the admin's process ahead of their first question, if it isn't running. */
  async prepare(principal: Principal): Promise<void> {
    const { release } = await this.acquire(principal);
    release();
  }

  /**
   * Starts Okta's server once, lists its tools and stops it, so whatever `uvx` downloads
   * (the package, Python) is in place before the first admin needs it. Resolves with the
   * time it took.
   */
  async warmUp(): Promise<number> {
    const started = Date.now();
    // okta-mcp-server only reads `exp` from the token at startup, and calls no Okta API here.
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(started / 1000) + 3600 })}.warm-up`;
    const id = '#warm-up'; // can't collide with an Okta user ID
    const session = await this.start(id, this.options.allowedScopes.join(' '), token);
    try {
      await (await session.client).listTools();
    } finally {
      await this.close(id);
    }
    return Date.now() - started;
  }

  private async start(userId: string, scopes: string, token: string): Promise<Session> {
    const home = await mkdtemp(join(await this.root, 'admin-'));
    await chmod(home, 0o700);
    const tokenFile = join(home, 'okta-token');

    const transport = new StdioClientTransport({
      command: this.options.command,
      args: this.options.args,
      cwd: home,
      stderr: 'pipe',
      // Merged over a minimal default (PATH, HOME, USER, ...); HOME is replaced.
      env: {
        ...this.options.env,
        HOME: home,
        XDG_DATA_HOME: join(home, '.local', 'share'),
        XDG_CONFIG_HOME: join(home, '.config'),
        OKTA_ORG_URL: this.options.oktaOrgUrl,
        OKTA_CLIENT_ID: this.options.oktaClientId,
        OKTA_SCOPES: scopes,
        OKTA_LOG_LEVEL: 'WARNING',
        PYTHON_KEYRING_BACKEND: 'oktamax_keyring.TokenFileKeyring',
        PYTHONPATH: this.options.keyringModuleDir,
        OKTAMAX_TOKEN_FILE: tokenFile,
      },
    });
    // Kept to explain a process that exits before it answers.
    let stderr = '';
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
      console.error(`[okta-mcp ${userId}] ${chunk.toString().trimEnd()}`);
    });

    const client = new Client({ name: 'oktamax-gateway', version: '0.1.0' });
    transport.onclose = () => {
      if (this.sessions.get(userId)?.client === session.client) this.sessions.delete(userId);
    };

    const session: Session = {
      transport,
      // The token must be in place before the server starts: it checks it at startup.
      client: writeToken(tokenFile, token)
        .then(() => client.connect(transport))
        .then(
          () => client,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
              throw new Error(
                `${this.options.command} not found: install uv, or set OKTA_MCP_COMMAND`,
              );
            }
            const output = stderr.trim();
            throw new Error(`${error.message}${output ? `. Its output:\n${output}` : ''}`);
          },
        ),
      home,
      tokenFile,
      scopes,
      lastUsed: Date.now(),
      inFlight: 0,
    };
    this.sessions.set(userId, session);
    return session;
  }

  async close(userId: string) {
    const session = this.sessions.get(userId);
    if (!session) return;
    this.sessions.delete(userId);
    // okta-mcp-server 1.1.x prints a harmless asyncio traceback when stdin closes.
    session.transport.stderr?.removeAllListeners('data');
    await session.client.then((c) => c.close()).catch(() => undefined);
    await rm(session.home, { recursive: true, force: true });
  }

  private async closeIdle() {
    const cutoff = Date.now() - (this.options.idleMs ?? 10 * 60_000);
    for (const [userId, session] of this.sessions) {
      if (session.inFlight === 0 && session.lastUsed < cutoff) await this.close(userId);
    }
  }

  /** At capacity, close the least recently used idle process (or fail if all are busy). */
  private async makeRoom() {
    const max = this.options.maxProcesses ?? 50;
    if (this.sessions.size < max) return;
    const idle = [...this.sessions].filter(([, s]) => s.inFlight === 0);
    idle.sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
    if (!idle[0]) throw new Error('Too many concurrent Okta MCP sessions; try again shortly');
    await this.close(idle[0][0]);
  }

  /** Number of running admin processes (for health checks and tests). */
  get size() {
    return this.sessions.size;
  }

  async closeAll() {
    clearInterval(this.reaper);
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
    await rm(await this.root, { recursive: true, force: true });
  }
}

/** Atomically replace the token file, readable only by this server's OS user. */
async function writeToken(file: string, token: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(tmp, token, { mode: 0o600 });
  await rename(tmp, file);
}
