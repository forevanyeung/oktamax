import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { ServerConfig } from '@oktamax/shared';

import { requireAuth } from './auth';
import { createChatRoutes, type ChatDeps } from './chat/routes';
import { config } from './config';
import { handleMcpRequest } from './mcp/gateway';
import type { OktaMcpProcessPool } from './mcp/processPool';

export const createApp = (deps: ChatDeps & { oktaMcp: OktaMcpProcessPool }) =>
  new Hono()
    .use(logger())
    // The extension calls from its service worker (chrome-extension:// origin);
    // MCP clients like Claude Desktop don't send an Origin at all.
    .use(cors({ origin: (origin) => (origin.startsWith('chrome-extension://') ? origin : null) }))
    .get('/health', (c) => c.text('ok'))
    .get('/api/config', (c) =>
      c.json<ServerConfig>({ oktaOrgUrl: config.oktaOrgUrl, oktaClientId: config.oktaClientId }),
    )
    .route('/api/chats', createChatRoutes(deps))
    .post('/mcp', requireAuth, (c) => handleMcpRequest(c.req.raw, c.var.principal, deps.oktaMcp))
    // Stateless server: no standalone SSE stream or sessions to delete.
    .on(['GET', 'DELETE'], '/mcp', (c) => c.json({ error: 'Method not allowed' }, 405));
