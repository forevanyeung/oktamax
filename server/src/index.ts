import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { MemoryChatStore } from './chat/store';
import { config } from './config';
import { OktaMcpProcessPool } from './mcp/processPool';

const bedrock = createAmazonBedrock({
  region: config.awsRegion,
  // Full AWS credential chain: env vars, SSO/profiles, ECS/EC2 roles.
  credentialProvider: fromNodeProviderChain(),
});

const oktaMcp = new OktaMcpProcessPool({
  ...config.oktaMcp,
  oktaOrgUrl: config.oktaOrgUrl,
  oktaClientId: config.oktaClientId,
});

const app = createApp({
  oktaMcp,
  model: bedrock(config.bedrockModelId),
  store: new MemoryChatStore(),
  mcpUrl: config.mcpUrl,
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`oktamax server listening on http://localhost:${port}`);
  console.log(`  Okta org:  ${config.oktaOrgUrl}`);
  console.log(`  Model:     ${config.bedrockModelId} (${config.awsRegion})`);
  console.log(`  Okta MCP:  ${config.oktaMcp.command} ${config.oktaMcp.args.join(' ')}`);
});

// Don't leave per-admin Okta MCP processes behind.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void oktaMcp.closeAll().finally(() => process.exit(0));
  });
}
