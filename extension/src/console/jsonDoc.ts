/**
 * Reading JSON as it's typed, for the body editor: where the cursor is (which
 * object, typing a key or a value), and a parse that keeps each value's position.
 * Paths are dotted, with `[]` for an array's items: `profile`, `roles[]`.
 */

/** `child` under `path`: `profile.login`. */
export const joinPath = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** The path above a field's: `profile` for `profile.login`, `roles[]` for `roles[].type`. */
export const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('.'), 0));

export interface Cursor {
  /** The object (or array's items) the cursor is in, e.g. `profile`, `roles[]`. */
  path: string;
  /** Typing an object's key, its value, or an array item. */
  slot: 'key' | 'value' | 'item';
  /** For `value`: the key it's the value of. */
  key?: string;
  /** Keys the object has before the cursor. */
  keys: string[];
  /** Where the token being typed starts (its opening quote, if any). */
  from: number;
  /** The token typed so far, without its opening quote. */
  prefix: string;
  quoted: boolean;
}

interface Frame {
  array: boolean;
  /** An object's path, or an array's items' (`roles[]`). */
  path: string;
  expect: 'key' | 'colon' | 'value' | 'comma';
  key?: string;
  keys: string[];
}

/** The end of the string starting at `start`, just past its closing quote, or -1. */
function stringEnd(text: string, start: number) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '"') return i + 1;
  }
  return -1;
}

const unquote = (token: string) => {
  try {
    return String(JSON.parse(token));
  } catch {
    return token.slice(1, -1);
  }
};

/**
 * What's being typed at `pos`, reading the text before it. Forgiving of the
 * half-written JSON it's given: a missing comma before a key is fine.
 */
export function cursorAt(text: string, pos: number): Cursor | undefined {
  const stack: Frame[] = [];
  const top = () => stack[stack.length - 1];
  const childPath = () => {
    const frame = top();
    if (!frame) return '';
    return frame.array ? frame.path : joinPath(frame.path, frame.key ?? '');
  };
  const at = (from: number, prefix: string, quoted: boolean): Cursor | undefined => {
    const frame = top();
    if (!frame) return undefined;
    const base = { path: frame.path, keys: frame.keys, from, prefix, quoted };
    if (frame.array) return frame.expect === 'colon' ? undefined : { ...base, slot: 'item' };
    if (frame.expect === 'key' || frame.expect === 'comma') return { ...base, slot: 'key' };
    if (frame.expect === 'value') return { ...base, slot: 'value', key: frame.key };
    return undefined;
  };
  /** A key or value token was read. */
  const token = (value: string) => {
    const frame = top();
    if (!frame) return;
    if (!frame.array && (frame.expect === 'key' || frame.expect === 'comma')) {
      frame.key = value;
      frame.keys.push(value);
      frame.expect = 'colon';
    } else if (frame.expect === 'value') {
      frame.expect = 'comma';
    }
  };

  for (let i = 0; i < pos; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    if (ch === '"') {
      const end = stringEnd(text, i);
      if (end < 0 || end > pos) return at(i, text.slice(i + 1, pos), true);
      token(unquote(text.slice(i, end)));
      i = end - 1;
    } else if (ch === ':') {
      const frame = top();
      if (frame && !frame.array) frame.expect = 'value';
    } else if (ch === ',') {
      const frame = top();
      if (frame) {
        frame.expect = frame.array ? 'value' : 'key';
        frame.key = undefined;
      }
    } else if (ch === '{' || ch === '[') {
      const path = childPath();
      const frame = top();
      if (frame) frame.expect = 'comma';
      stack.push({
        array: ch === '[',
        path: ch === '[' ? `${path}[]` : path,
        expect: ch === '[' ? 'value' : 'key',
        keys: [],
      });
    } else if (ch === '}' || ch === ']') {
      stack.pop();
    } else {
      const word = /[^\s"{}[\],:]+/y;
      word.lastIndex = i;
      const end = i + (word.exec(text)?.[0].length ?? 1);
      if (end >= pos) return at(i, text.slice(i, pos), false);
      token(text.slice(i, end));
      i = end - 1;
    }
  }
  return at(pos, '', false);
}

/** The key under `pos`, if it's on one: its full text and range. */
export function keyAt(text: string, pos: number) {
  const cursor = cursorAt(text, pos);
  if (!cursor?.quoted || cursor.slot !== 'key') return undefined;
  const end = stringEnd(text, cursor.from);
  if (end < 0) return undefined;
  return {
    path: joinPath(cursor.path, unquote(text.slice(cursor.from, end))),
    from: cursor.from,
    to: end,
  };
}

export type JsonNode =
  | { kind: 'object'; from: number; to: number; props: JsonProp[] }
  | { kind: 'array'; from: number; to: number; items: JsonNode[] }
  | {
      kind: 'string' | 'number' | 'boolean' | 'null';
      from: number;
      to: number;
      value: string | number | boolean | null;
    };

export interface JsonProp {
  key: string;
  keyFrom: number;
  keyTo: number;
  value: JsonNode;
}

/** Parses JSON keeping every value's and key's position; undefined if it isn't valid. */
export function parseJson(text: string): JsonNode | undefined {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`at ${i}`);
  };
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const match = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(text)?.[0];
    if (m === undefined) fail();
    i += m!.length;
    return m!;
  };
  // JSON.parse rejects what the pattern lets through, like raw control characters.
  const string = () => JSON.parse(match(/"(?:[^"\\]|\\.)*"/y)) as string;

  const value = (): JsonNode => {
    space();
    const from = i;
    const ch = text[i];
    if (ch === '{') {
      i++;
      const props: JsonProp[] = [];
      space();
      if (text[i] === '}') i++;
      else {
        for (;;) {
          space();
          const keyFrom = i;
          const key = string();
          const keyTo = i;
          space();
          if (text[i++] !== ':') fail();
          props.push({ key, keyFrom, keyTo, value: value() });
          space();
          const next = text[i++];
          if (next === '}') break;
          if (next !== ',') fail();
        }
      }
      return { kind: 'object', from, to: i, props };
    }
    if (ch === '[') {
      i++;
      const items: JsonNode[] = [];
      space();
      if (text[i] === ']') i++;
      else {
        for (;;) {
          items.push(value());
          space();
          const next = text[i++];
          if (next === ']') break;
          if (next !== ',') fail();
        }
      }
      return { kind: 'array', from, to: i, items };
    }
    if (ch === '"') return { kind: 'string', from, value: string(), to: i };
    const word = match(/true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y);
    if (word === 'null') return { kind: 'null', from, to: i, value: null };
    if (word === 'true' || word === 'false') {
      return { kind: 'boolean', from, to: i, value: word === 'true' };
    }
    return { kind: 'number', from, to: i, value: Number(word) };
  };

  try {
    const root = value();
    space();
    return i === text.length ? root : undefined;
  } catch {
    return undefined;
  }
}
