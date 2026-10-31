/** Server configuration, read once from the environment (and `.env` if present). */
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
  awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  /** Bedrock model or inference profile ID. */
  bedrockModelId: process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-5-5',
  /** How to start Okta's MCP server (stdio). Pinned, since we rely on its keyring/scope behaviour. */
  oktaMcp: {
    command: process.env.OKTA_MCP_COMMAND ?? 'uvx',
    args: (process.env.OKTA_MCP_ARGS ?? 'okta-mcp-server@1.1.7').split(' ').filter(Boolean),
    keyringModuleDir: fileURLToPath(new URL('../python', import.meta.url)),
    allowedScopes: OKTA_SCOPES.filter((s) => s !== 'openid'),
    idleMs: Number(process.env.OKTA_MCP_IDLE_MINUTES ?? 10) * 60_000,
    maxProcesses: Number(process.env.OKTA_MCP_MAX_PROCESSES ?? 50),
    // One shared package cache, rather than one per admin HOME.
    env: process.env.UV_CACHE_DIR ? { UV_CACHE_DIR: process.env.UV_CACHE_DIR } : undefined,
  },
  /** Where the chat route reaches the MCP gateway. Defaults to this process. */
  mcpUrl: process.env.MCP_URL ?? `http://localhost:${process.env.PORT ?? 8787}/mcp`,
};
