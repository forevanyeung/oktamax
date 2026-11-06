/**
 * `blockTools`: hides tools from the gateway, by name or glob.
 *
 *   { "type": "blockTools", "tools": ["list_system_logs", "*_application*"] }
 */
import * as z from 'zod';

import type { HookFactory } from '.';
import { glob } from './util';

const optionsSchema = z.object({ tools: z.array(z.string()).min(1) }).strict();

export const blockTools: HookFactory = (options) => {
  const { tools } = optionsSchema.parse(options);
  const blocked = tools.map(glob);
  return {
    name: `blockTools(${tools.join(', ')})`,
    allowTool: (name) => !blocked.some((re) => re.test(name)),
  };
};
