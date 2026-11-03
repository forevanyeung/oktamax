import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { serve } from '@hono/node-server';

import { createApp } from './app';
import { MemoryChatStore } from './chat/store';
import { config } from './config';
import { OktaMcpProcessPool } from './mcp/processPool';

const model =
  config.model.provider === 'anthropic'
    ? createAnthropic({ apiKey: config.model.apiKey })(config.model.modelId)
    : createAmazonBedrock({
        region: config.model.region,
        // Full AWS credential chain: env vars, SSO/profiles, ECS/EC2 roles.
        credentialProvider: fromNodeProviderChain(),
      })(config.model.modelId);

const oktaMcp = new OktaMcpProcessPool(config.oktaMcp);

const app = createApp({
  oktaMcp,
  model,
  store: new MemoryChatStore(),
  mcpUrl: config.mcpUrl,
});

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`oktamax server listening on http://localhost:${port}`);
  const base = config.publicUrl ?? `http://localhost:${port}`;
  for (const org of config.orgs)
    console.log(`  Okta org:  ${org.url}  MCP: ${base}/mcp/${org.host}`);
  const where =
    config.model.provider === 'anthropic' ? 'Anthropic API' : `Bedrock, ${config.model.region}`;
  console.log(`  Model:     ${config.model.modelId} (${where})`);
  console.log(`  Okta MCP:  ${config.oktaMcp.command} ${config.oktaMcp.args.join(' ')}`);
  // Have okta-mcp-server (with uvx, its download) ready before the first question.
  oktaMcp.warmUp(config.orgs[0]!).then(
    (ms) => console.log(`  Okta MCP:  ready (${(ms / 1000).toFixed(1)}s)`),
    (error) => console.error(`  Okta MCP:  failed to start: ${error}`),
  );
});

// Don't leave per-admin Okta MCP processes behind.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void oktaMcp.closeAll().finally(() => process.exit(0));
  });
}
