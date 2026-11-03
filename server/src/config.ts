/** Server configuration, read once from the environment (and `.env` if present). */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OKTA_SCOPES } from '@oktamax/shared';

try {
  process.loadEnvFile();
} catch {
  // No .env file – rely on the real environment.
}

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

/** An Okta org this server serves, and the OIDC app its admins sign in with. */
export interface OktaOrg {
  /** e.g. acme.okta.com: names the org in URLs (`/mcp/acme.okta.com`). */
  host: string;
  /** e.g. https://acme.okta.com */
  url: string;
  /** Client ID of the org's OIDC app (public client, PKCE). */
  clientId: string;
}

const org = (url: string, clientId: string): OktaOrg => {
  const { origin, host } = new URL(url);
  return { host, url: origin, clientId };
};

/**
 * OKTA_ORG_URL + OKTA_CLIENT_ID for one org, and/or OKTA_ORGS for more:
 * `https://acme.okta.com=0oa123 https://acme.oktapreview.com=0oa456`.
 */
function readOrgs(): OktaOrg[] {
  const orgs = (process.env.OKTA_ORGS ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const [url, clientId] = entry.split('=');
      if (!url || !clientId)
        throw new Error(`OKTA_ORGS: expected <org url>=<client id>, got ${entry}`);
      return org(url, clientId);
    });
  if (process.env.OKTA_ORG_URL || !orgs.length) {
    orgs.unshift(org(required('OKTA_ORG_URL'), required('OKTA_CLIENT_ID')));
  }
  const hosts = orgs.map((o) => o.host);
  const dup = hosts.find((host, i) => hosts.indexOf(host) !== i);
  if (dup) throw new Error(`${dup} is configured twice`);
  return orgs;
}

const orgs = readOrgs();

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** The orgs whose admins use this server. Each has its own MCP server at `/mcp/<host>`. */
  orgs,
  /** The configured org with this host (acme.okta.com), if any. */
  org: (host: string) => orgs.find((o) => o.host === host),
  /**
   * The server's public URL, e.g. https://oktamax.example.com: MCP clients are sent
   * back to it while signing in. Defaults to the URL each request came in on.
   */
  publicUrl: process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL).origin : undefined,
  /**
   * Signs the client IDs handed to MCP clients, so registrations survive restarts.
   * Without it they last until the server restarts, and clients register again.
   */
  oauthSecret: process.env.OAUTH_SECRET,
  /**
   * Which model to use: Anthropic's API if there's an API key, otherwise Bedrock.
   * MODEL_ID is a model ID for the API, or a Bedrock model or inference profile ID.
   */
  model: process.env.ANTHROPIC_API_KEY
    ? {
        provider: 'anthropic' as const,
        apiKey: process.env.ANTHROPIC_API_KEY,
        modelId: process.env.MODEL_ID ?? 'claude-opus-5-5',
      }
    : {
        provider: 'bedrock' as const,
        region: process.env.AWS_REGION ?? 'us-east-1',
        modelId: process.env.MODEL_ID ?? 'us.anthropic.claude-opus-5-5',
      },
  /** How to start Okta's MCP server (stdio). Pinned, since we rely on its keyring/scope behaviour. */
  oktaMcp: {
    command: process.env.OKTA_MCP_COMMAND ?? 'uvx',
    args: (process.env.OKTA_MCP_ARGS ?? 'okta-mcp-server@1.1.7').split(' ').filter(Boolean),
    keyringModuleDir: fileURLToPath(new URL('../python', import.meta.url)),
    allowedScopes: OKTA_SCOPES.filter((s) => s !== 'openid'),
    idleMs: Number(process.env.OKTA_MCP_IDLE_MINUTES ?? 10) * 60_000,
    maxProcesses: Number(process.env.OKTA_MCP_MAX_PROCESSES ?? 50),
    // uv keeps its cache and Pythons under HOME, which each admin's process gets fresh. Use
    // the server user's instead, so `uvx` downloads okta-mcp-server and Python once, not per
    // process. They hold only packages; every process runs as this same OS user anyway.
    env: {
      UV_CACHE_DIR:
        process.env.UV_CACHE_DIR ??
        join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'uv'),
      UV_PYTHON_INSTALL_DIR:
        process.env.UV_PYTHON_INSTALL_DIR ??
        join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'uv', 'python'),
    },
  },
  /** Where the chat route reaches the MCP gateway (`<mcpUrl>/<org host>`). Defaults to this process. */
  mcpUrl: process.env.MCP_URL ?? `http://localhost:${process.env.PORT ?? 8787}/mcp`,
};
