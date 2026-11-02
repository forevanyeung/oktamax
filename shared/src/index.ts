/**
 * Contract between the extension and the chat server.
 */

/** What the admin is looking at when they send a message. Sent with every chat request. */
export interface PageContext {
  url: string;
  title: string;
  /** Visible h1–h3 headings, top to bottom (e.g. app name, "SAML Settings"). */
  headings: string[];
  /** Okta object IDs found in the URL (apps, policies, groups, users, ...). */
  objectIds: string[];
  /** Text the admin has selected on the page, if any. */
  selection?: string;
  /** Visible text of the main content area, truncated. */
  text: string;
}

/**
 * Metadata on user messages. The page context travels with the message it was
 * asked from, so the model (and the transcript) know where each question came from.
 */
export interface ChatMessageMetadata {
  page?: PageContext;
}

/** Body of `POST /api/chats/:id/messages`: only the new message; the server holds the history. */
export interface SendMessageBody<Message> {
  message: Message;
}

/** `GET /api/config`: public settings the extension needs before signing in. */
export interface ServerConfig {
  oktaOrgUrl: string;
  oktaClientId: string;
}

/**
 * Okta API scopes the extension requests: the read scopes Okta's MCP server
 * (okta/okta-mcp-server) uses. Read-only, so even an admin with write roles
 * can't change anything through this token.
 */
export const OKTA_SCOPES = [
  'openid',
  'okta.apps.read',
  'okta.brands.read',
  'okta.deviceAssurance.read',
  'okta.domains.read',
  'okta.emailDomains.read',
  'okta.groups.read',
  'okta.logs.read',
  'okta.policies.read',
  'okta.templates.read',
  'okta.users.read',
] as const;
