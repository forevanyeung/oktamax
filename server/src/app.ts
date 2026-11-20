import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import type { ServerConfig } from '@oktamax/shared';
import {
  EXTENSION_VERSION_HEADER,
  isAtLeast,
  MIN_EXTENSION_VERSION,
  type ExtensionOutdated,
} from '@oktamax/shared/version';

import pkg from '../package.json' with { type: 'json' };

import { requireAuth } from './auth';
import { createChatRoutes, type ChatDeps } from './chat/routes';
import { config } from './config';
import { handleMcpRequest } from './mcp/gateway';
import { createOAuthRoutes, signInChallenge } from './mcp/oauth';
import type { OktaMcpProcessPool } from './mcp/processPool';

/** Paths MCP clients use, which may be web apps on any origin: the MCP servers and sign-in. */
const OPEN_PATHS = /^\/(mcp|oauth|\.well-known)\//;

const requestLog = logger();

export const SERVER_VERSION = pkg.version;

export const createApp = (
  deps: ChatDeps & {
    oktaMcp: OktaMcpProcessPool;
  },
) =>
  new Hono()
    // Health checks arrive every few seconds and drown out real requests.
    .use((c, next) => (c.req.path === '/health' && !config.debug ? next() : requestLog(c, next)))
    // The extension calls from its service worker (chrome-extension:// origin). MCP
    // clients like Claude Desktop don't send an Origin at all; web-based ones may.
    // Tokens travel in headers, never cookies, so any origin can call those paths.
    .use(
      cors({
        origin: (origin, c) =>
          origin.startsWith('chrome-extension://') || OPEN_PATHS.test(c.req.path) ? origin : null,
        exposeHeaders: ['WWW-Authenticate'],
      }),
    )
    .get('/health', (c) => c.text('ok'))
    .get('/api/config', (c) =>
      c.json<ServerConfig>({
        orgs: config.orgs.map((org) => ({ oktaOrgUrl: org.url, oktaClientId: org.clientId })),
        version: SERVER_VERSION,
        minExtensionVersion: MIN_EXTENSION_VERSION,
      }),
    )
    // An extension too old for this server is told so, rather than failing in ways it can't
    // explain. `/api/config` stays open: it's how an extension learns it's out of date.
    .use('/api/chats/*', async (c, next) => {
      if (isAtLeast(c.req.header(EXTENSION_VERSION_HEADER), MIN_EXTENSION_VERSION)) return next();
      return c.json<ExtensionOutdated>(
        {
          error: 'extension_outdated',
          serverVersion: SERVER_VERSION,
          minExtensionVersion: MIN_EXTENSION_VERSION,
        },
        426,
      );
    })
    .route('/api/chats', createChatRoutes(deps))
    // One MCP server per org, each with its own sign-in.
    .post(
      '/mcp/:org',
      requireAuth((c) => config.org(c.req.param('org') ?? ''), signInChallenge),
      (c) =>
        handleMcpRequest(c.req.raw, c.var.principal, deps.oktaMcp, deps.hooks, () =>
          signInChallenge(c, c.var.principal.org, 'invalid_token'),
        ),
    )
    // Stateless server: no standalone SSE stream or sessions to delete.
    .on(['GET', 'DELETE'], '/mcp/:org', (c) => c.json({ error: 'Method not allowed' }, 405))
    .route('/', createOAuthRoutes());
