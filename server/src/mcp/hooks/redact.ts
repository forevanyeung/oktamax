/**
 * `redact`: withholds personal data from tool results.
 *
 *   { "type": "redact",
 *     "preset": "pii",                    // default; "none" starts from nothing
 *     "fields": ["employeeNumber", "profile.city"],
 *     "patterns": ["email", { "name": "badge ID", "regex": "B-\\d{6}" }],
 *     "allow": ["zipCode", "phone"],      // keep these preset fields / patterns
 *     "replacement": "[redacted]",
 *     "blockFilters": true }
 *
 * Fields are matched by name (case-insensitive, `*` globs), or by the end of
 * their dotted path when they contain a dot (`profile.city`). A field's value is
 * replaced when it's a string, number or boolean (or a list of them); objects
 * are searched further, so a policy's `phone` settings aren't wiped out.
 * Patterns are matched in every string, and in text that isn't JSON.
 *
 * With `blockFilters`, calls whose arguments refer to a redacted field
 * (`search: 'profile.mobilePhone eq "…"'`) are refused, so the data can't be
 * found out by searching for it.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import * as z from 'zod';

import type { HookFactory, ToolCall } from '.';
import { glob } from './util';

/** The `pii` preset's fields, by what the model is told is withheld. */
export const PII_FIELDS: Record<string, string[]> = {
  'dates of birth': ['*birthdate*', '*birthday*', 'dateOfBirth', 'dob'],
  'phone numbers': ['*phone*', 'mobile', 'fax*'],
  'street addresses': [
    'streetAddress',
    'postalAddress',
    'homeAddress',
    'mailingAddress',
    'address',
    'addressLine*',
    'zipCode',
    'postalCode',
  ],
  'government ID numbers': [
    'ssn',
    'socialSecurityNumber',
    'nationalId*',
    'taxId',
    'passport*',
    'driversLicense*',
  ],
};

/** Patterns `patterns` can name. Each needs separators or context, so IDs and dates don't match. */
export const BUILTIN_PATTERNS: Record<string, RegExp> = {
  // +1 (555) 123-4567, 555.123.4567, and E.164 (+15551234567), as Okta stores them.
  phone:
    /(?<![\w+])(?:(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}|\+[1-9]\d{9,14})(?!\w)/g,
  ssn: /(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g,
  email: /[\w.%+-]+@[A-Za-z\d.-]+\.[A-Za-z]{2,}/g,
};
const PII_PATTERNS = ['phone', 'ssn'];

const optionsSchema = z
  .object({
    preset: z.enum(['pii', 'none']).default('pii'),
    fields: z.array(z.string()).default([]),
    patterns: z
      .array(
        z.union([
          z.string(),
          z.object({ name: z.string(), regex: z.string(), flags: z.string().optional() }),
        ]),
      )
      .default([]),
    allow: z.array(z.string()).default([]),
    replacement: z.string().default('[redacted]'),
    blockFilters: z.boolean().default(true),
  })
  .strict();

/** Matches a field glob against a path of keys: by name, or by dotted path suffix. */
const fieldMatcher = (pattern: string) => {
  if (!pattern.includes('.')) {
    const re = glob(pattern);
    return (path: string[]) => re.test(path.at(-1) ?? '');
  }
  const re = new RegExp(`^(?:.*\\.)?${glob(pattern).source.slice(1)}`, 'i');
  return (path: string[]) => re.test(path.join('.'));
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isLeaf = (v: Json) => v === null || typeof v !== 'object';

export const redact: HookFactory = (options) => {
  const opts = optionsSchema.parse(options);
  const allowed = new Set(opts.allow.map((a) => a.toLowerCase()));
  const allowMatchers = opts.allow.map(fieldMatcher);

  const preset = opts.preset === 'pii' ? PII_FIELDS : {};
  const fieldGlobs = [...Object.values(preset).flat(), ...opts.fields].filter(
    (f) => !allowed.has(f.toLowerCase()),
  );
  const fieldMatchers = fieldGlobs.map(fieldMatcher);
  const isField = (path: string[]) =>
    fieldMatchers.some((m) => m(path)) && !allowMatchers.some((m) => m(path));

  const patterns = [...(opts.preset === 'pii' ? PII_PATTERNS : []), ...opts.patterns]
    .filter((p) => typeof p !== 'string' || !allowed.has(p.toLowerCase()))
    .map((p) => {
      if (typeof p !== 'string') return { name: p.name, re: new RegExp(p.regex, p.flags ?? 'g') };
      const re = BUILTIN_PATTERNS[p];
      if (!re)
        throw new Error(
          `redact: unknown pattern ${p} (one of ${Object.keys(BUILTIN_PATTERNS).join(', ')})`,
        );
      return { name: p, re };
    })
    // replace() needs the g flag to replace every match.
    .map(({ name, re }) => ({ name, re: re.global ? re : new RegExp(re.source, `${re.flags}g`) }));

  const withheld = opts.replacement;
  const scrub = (text: string) => patterns.reduce((t, { re }) => t.replace(re, withheld), text);

  const redactJson = (value: Json, path: string[] = []): Json => {
    if (typeof value === 'string') return scrub(value);
    if (Array.isArray(value)) return value.map((v) => redactJson(v, path));
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => {
        const at = [...path, key];
        if (isField(at)) {
          if (isLeaf(v)) return [key, v === null ? null : withheld];
          if (Array.isArray(v) && v.every(isLeaf))
            return [key, v.map((x) => (x === null ? null : withheld))];
        }
        return [key, redactJson(v, at)];
      }),
    );
  };

  /** Text that isn't JSON (or has JSON inside it): quoted "key": value pairs, then patterns. */
  const redactText = (text: string) =>
    scrub(
      text.replace(
        /(["'])([\w.-]+)\1(\s*:\s*)(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d[\d.eE+-]*)/g,
        (pair, quote: string, key: string, colon: string) =>
          isField(key.split('.'))
            ? `${quote}${key}${quote}${colon}${quote}${withheld}${quote}`
            : pair,
      ),
    );

  const redactContentText = (text: string) => {
    let json: Json;
    try {
      json = JSON.parse(text) as Json;
    } catch {
      return redactText(text);
    }
    return JSON.stringify(redactJson(json), null, text.includes('\n') ? 2 : undefined);
  };

  /** The first dotted field reference in the call's arguments that's redacted. */
  const redactedReference = (value: unknown): string | undefined => {
    if (typeof value === 'string') {
      for (const [ref] of value.matchAll(/[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g)) {
        if (isField(ref.split('.'))) return ref;
      }
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) {
        const ref = redactedReference(v);
        if (ref) return ref;
      }
    }
    return undefined;
  };

  // A category is still withheld while any of its fields is neither removed nor allowed by a glob.
  const categories = Object.entries(preset)
    .filter(([, fields]) =>
      fields.some((f) => fieldGlobs.includes(f) && !allowMatchers.some((m) => m(f.split('.')))),
    )
    .map(([category]) => category);
  const what = [
    ...categories,
    ...(opts.fields.length ? [`these fields: ${opts.fields.join(', ')}`] : []),
    ...patterns.filter((p) => !PII_PATTERNS.includes(p.name)).map((p) => p.name),
  ];

  return {
    name: 'redact',
    instructions: what.length
      ? `This server withholds personal data from Okta results: ${what.join('; ')}. Withheld values show as "${withheld}". Don't try to find them out another way (other tools, or searching or filtering on those fields), and don't guess them. If asked for them, say this server withholds them.`
      : undefined,
    beforeCall: (call: ToolCall) => {
      if (!opts.blockFilters) return;
      const ref = redactedReference(call.arguments);
      if (ref) return `Searching or filtering on ${ref} isn't allowed: this server withholds it.`;
    },
    afterCall: (result: CallToolResult): CallToolResult => ({
      ...result,
      content: result.content.map((item) => {
        if (item.type === 'text') return { ...item, text: redactContentText(item.text) };
        if (item.type === 'resource' && 'text' in item.resource)
          return {
            ...item,
            resource: { ...item.resource, text: redactContentText(item.resource.text) },
          };
        return item;
      }),
      ...(result.structuredContent && {
        structuredContent: redactJson(result.structuredContent as Json) as Record<string, unknown>,
      }),
    }),
  };
};
