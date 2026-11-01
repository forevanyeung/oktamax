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

const oktaOrgUrl = new URL(required('OKTA_ORG_URL')).origin;

export const config = {
  port: Number(process.env.PORT ?? 8787),
  /** e.g. https://acme.okta.com – the org whose admins use this server. */
  oktaOrgUrl,
  /** Client ID of the OIDC app the extension signs in with (public client, PKCE). */
  oktaClientId: required('OKTA_CLIENT_ID'),
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
  /** Where the chat route reaches the MCP gateway. Defaults to this process. */
  mcpUrl: process.env.MCP_URL ?? `http://localhost:${process.env.PORT ?? 8787}/mcp`,
};
