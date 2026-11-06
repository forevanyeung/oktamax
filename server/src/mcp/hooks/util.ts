import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export const refusal = (text: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text }],
});

/** Case-insensitive glob (`*` matches anything) → RegExp. */
export const glob = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i',
  );
