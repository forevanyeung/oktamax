/**
 * Hooks: rules the MCP gateway applies to every tool call, on top of read-only.
 *
 * A hook can hide tools, refuse a call before it reaches Okta's server, rewrite
 * the result before it reaches the client (the assistant, or an admin's own MCP
 * client), and tell the model about itself in the server's instructions.
 *
 * Hooks come from a JSON file (MCP_HOOKS_FILE), applied in order:
 *
 *   { "hooks": [
 *       { "type": "redact", "fields": ["employeeNumber"], "allow": ["zipCode"] },
 *       { "type": "blockTools", "tools": ["list_system_logs"], "orgs": ["acme.okta.com"] },
 *       { "type": "module", "path": "./my-hook.ts", "options": { ... } }
 *   ] }
 *
 * Without a file, the gateway redacts personal data (`redact` with its defaults).
 * Every entry can also have `orgs` (only apply to these org hosts) and
 * `instructions` (replace what the hook tells the model). New built-in types go
 * in `HOOK_TYPES`; `module` loads one from a file without changing this server.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';

import type { Principal } from '../../auth';
import { blockTools } from './blockTools';
import { redact } from './redact';
import { refusal } from './util';

export { glob, refusal } from './util';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface HookContext {
  /** The admin making the call, and their org. */
  principal: Principal;
}

export interface ToolHook {
  /** Shown in logs and refusals. */
  name: string;
  /** Told to the model (the MCP server's instructions), e.g. what's withheld and why. */
  instructions?: string;
  /** False hides the tool from the tool list and refuses calls to it. */
  allowTool?(name: string): boolean;
  /** Runs before Okta's server is called. Return a message to refuse the call with it. */
  beforeCall?(call: ToolCall, context: HookContext): string | void | Promise<string | void>;
  /** Rewrites the result before it reaches the client. */
  afterCall?(
    result: CallToolResult,
    call: ToolCall,
    context: HookContext,
  ): CallToolResult | Promise<CallToolResult>;
}

/** Builds a hook from its entry's options (everything but `type`, `orgs` and `instructions`). */
export type HookFactory = (options: Record<string, unknown>) => ToolHook | Promise<ToolHook>;

const entrySchema = z
  .object({
    type: z.string(),
    orgs: z.array(z.string()).optional(),
    instructions: z.string().optional(),
  })
  .passthrough();
const fileSchema = z.union([
  z.object({ hooks: z.array(entrySchema) }),
  z.array(entrySchema).transform((hooks) => ({ hooks })),
]);
export type HookEntry = z.input<typeof entrySchema>;

const moduleSchema = z.object({ path: z.string(), options: z.record(z.string(), z.unknown()) });

/**
 * `module` loads a hook from a file (resolved from the hooks file's directory)
 * whose default export is a `HookFactory`, called with the entry's `options`.
 */
const moduleHook =
  (baseDir: string): HookFactory =>
  async (options) => {
    const { path, options: moduleOptions } = moduleSchema.parse({ options: {}, ...options });
    const url = pathToFileURL(resolve(baseDir, path)).href;
    const factory = ((await import(url)) as { default?: unknown }).default;
    if (typeof factory !== 'function') throw new Error(`${path}: default export isn't a function`);
    return (factory as HookFactory)(moduleOptions);
  };

/** Built-in hook types, by the `type` used in the hooks file. */
export const HOOK_TYPES: Record<string, HookFactory> = { redact, blockTools };

/** What applies when there's no hooks file: redact personal data. */
export const DEFAULT_HOOKS: HookEntry[] = [{ type: 'redact' }];

interface ScopedHook {
  hook: ToolHook;
  /** Org hosts it applies to; all when undefined. */
  orgs?: string[];
}

/** The configured hooks, ready to pick per org. */
export class ToolHooks {
  constructor(private readonly scoped: ScopedHook[] = []) {}

  /** Builds hooks from file entries. `baseDir` resolves `module` paths. */
  static async create(entries: HookEntry[], baseDir = process.cwd()): Promise<ToolHooks> {
    const types: Record<string, HookFactory> = { ...HOOK_TYPES, module: moduleHook(baseDir) };
    const scoped: ScopedHook[] = [];
    for (const [i, entry] of entries.entries()) {
      const { type, orgs, instructions, ...options } = entrySchema.parse(entry);
      const factory = types[type];
      if (!factory) {
        throw new Error(
          `hooks[${i}]: unknown type ${type} (one of ${Object.keys(types).join(', ')})`,
        );
      }
      const hook = await factory(options);
      scoped.push({ hook: instructions === undefined ? hook : { ...hook, instructions }, orgs });
    }
    return new ToolHooks(scoped);
  }

  /** Reads a hooks file; without one, `DEFAULT_HOOKS`. */
  static async load(file?: string): Promise<ToolHooks> {
    if (!file) return ToolHooks.create(DEFAULT_HOOKS);
    const text = await readFile(file, 'utf8');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) throw new Error(`${file}: ${z.prettifyError(parsed.error)}`);
    return ToolHooks.create(parsed.data.hooks, dirname(resolve(file)));
  }

  /** Names of the hooks, for the startup log. */
  get names() {
    return this.scoped.map(
      ({ hook, orgs }) => `${hook.name}${orgs ? ` (${orgs.join(', ')})` : ''}`,
    );
  }

  /** The hooks that apply to this org, in order. */
  for(orgHost: string): HookPipeline {
    return new HookPipeline(
      this.scoped.filter(({ orgs }) => !orgs || orgs.includes(orgHost)).map(({ hook }) => hook),
    );
  }
}

export class HookPipeline {
  constructor(readonly hooks: ToolHook[]) {}

  /** Every hook's instructions, for the MCP server's instructions. */
  get instructions(): string | undefined {
    const parts = this.hooks.map((h) => h.instructions).filter(Boolean);
    return parts.length ? parts.join('\n\n') : undefined;
  }

  allowTool(name: string) {
    return this.hooks.every((h) => h.allowTool?.(name) ?? true);
  }

  /**
   * Runs `forward` (the call to Okta's server) between the hooks. Hooks run in
   * order before the call and in reverse after it, like middleware; a hook that
   * throws fails the call, so nothing passes a broken hook unchecked.
   */
  async call(
    call: ToolCall,
    context: HookContext,
    forward: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    if (!this.allowTool(call.name)) return refusal(`${call.name} is not available on this server.`);
    for (const hook of this.hooks) {
      const refused = await hook.beforeCall?.(call, context);
      if (refused) return refusal(refused);
    }
    let result = await forward();
    for (const hook of [...this.hooks].reverse()) {
      if (hook.afterCall) result = await hook.afterCall(result, call, context);
    }
    return result;
  }
}
