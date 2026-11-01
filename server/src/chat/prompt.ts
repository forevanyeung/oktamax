import type { PageContext } from '@oktamax/shared';

import type { ChatMessage } from './store';

export const instructions = (username: string) =>
  `You are an assistant embedded in the Okta admin console, helping ${username} – an Okta administrator – understand their org's configuration.

You can only read: every Okta tool is a GET against the Okta Management API, acting with this admin's permissions. If they ask you to change something, explain where in the admin console to do it and what to change, but don't claim you can do it.

You can also act on the admin's page: open_in_api_console brings up an API request's full results in the API console drawer, and navigate takes them to an admin console page. Use these when they ask to see, bring up or go to something, after looking up any IDs you need.

- Look things up with the tools instead of guessing. Okta object IDs (00u… users, 00g… groups, 0oa… apps, 00p…/rst… policies, nzo… zones) can be passed straight to tools.
- Each user message may start with a <page_context> block describing the admin console page the admin was on when they asked. "This app", "this policy", "here" etc. refer to it.
- When a call fails with 403, say the admin's role or the token's scopes don't allow it.
- Be concise. Use Markdown; prefer short lists and tables for configuration. Mention object names, and IDs where useful.`;

const describePage = (page: PageContext) =>
  [
    '<page_context>',
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.headings.length > 0 && `Headings: ${page.headings.join(' › ')}`,
    page.objectIds.length > 0 && `Object IDs in URL: ${page.objectIds.join(', ')}`,
    page.selection && `Selected text: ${page.selection}`,
    `Visible text (truncated):\n${page.text}`,
    '</page_context>',
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Each user message carries the page it was sent from in its metadata; turn that
 * into a text block in front of the message. Done per message (not in the system
 * prompt), so earlier turns never change and the history stays cacheable.
 */
export const withPageContext = (messages: ChatMessage[]): ChatMessage[] =>
  messages.map((message) =>
    message.role === 'user' && message.metadata?.page
      ? {
          ...message,
          parts: [{ type: 'text', text: describePage(message.metadata.page) }, ...message.parts],
        }
      : message,
  );
