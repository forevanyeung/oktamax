/**
 * A collapsible, colored JSON tree. Collapsed objects show a short preview of
 * their values, and API links can be opened with a click.
 */
import { useState } from 'react';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isContainer = (value: Json): value is Json[] | { [key: string]: Json } =>
  typeof value === 'object' && value !== null;

const entriesOf = (value: Json[] | { [key: string]: Json }): Array<[string, Json]> =>
  Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value);

const isApiLink = (s: string) => /^https:\/\/[^/]+\/api\//.test(s);

/** Open on first render: the top levels, but not Okta's `_links` / `_embedded`, or long lists. */
const openByDefault = (
  name: string | undefined,
  value: Json[] | { [key: string]: Json },
  depth: number,
) =>
  depth === 0 ||
  (depth < 3 && !name?.startsWith('_') && !(Array.isArray(value) && value.length > 50));

const Scalar = ({ value, onOpen }: { value: Json; onOpen: (href: string) => void }) => {
  if (typeof value === 'string') {
    return isApiLink(value) ? (
      <button
        type="button"
        className="j-link"
        title="Open in the console"
        onClick={() => onOpen(value)}
      >
        "{value}"
      </button>
    ) : (
      <span className="j-string">"{value}"</span>
    );
  }
  if (typeof value === 'number') return <span className="j-number">{value}</span>;
  return <span className="j-literal">{String(value)}</span>;
};

const PREVIEW_LENGTH = 90;

const truncate = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `{ id: "00u1", status: "ACTIVE", … }` for a collapsed object. */
function preview(value: Json[] | { [key: string]: Json }): string {
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  const parts: string[] = [];
  let length = 0;
  for (const [key, v] of entriesOf(value)) {
    const shown = isContainer(v)
      ? Array.isArray(v)
        ? '[…]'
        : '{…}'
      : truncate(JSON.stringify(v), 40);
    const part = Array.isArray(value) ? shown : `${key}: ${shown}`;
    if (length + part.length > PREVIEW_LENGTH) {
      parts.push('…');
      break;
    }
    parts.push(part);
    length += part.length + 2;
  }
  return parts.length ? `${open} ${parts.join(', ')} ${close}` : `${open}${close}`;
}

const count = (value: Json[] | { [key: string]: Json }) => {
  const n = Array.isArray(value) ? value.length : Object.keys(value).length;
  return Array.isArray(value) ? `${n} item${n === 1 ? '' : 's'}` : `${n} key${n === 1 ? '' : 's'}`;
};

interface NodeProps {
  name?: string;
  /** Array indices are shown muted, without quotes. */
  isIndex?: boolean;
  value: Json;
  depth: number;
  comma: boolean;
  expand?: boolean;
  onOpen: (href: string) => void;
}

const Node = ({ name, isIndex, value, depth, comma, expand, onOpen }: NodeProps) => {
  const container = isContainer(value);
  const [open, setOpen] = useState(() =>
    container ? depth === 0 || (expand ?? openByDefault(name, value, depth)) : false,
  );
  const indent = { paddingLeft: depth * 16 + 16 };
  const label =
    name === undefined ? null : isIndex ? (
      <span className="j-index">{name}: </span>
    ) : (
      <span className="j-key">"{name}": </span>
    );

  if (!container) {
    return (
      <div className="j-line" style={indent}>
        {label}
        <Scalar value={value} onOpen={onOpen} />
        {comma && <span className="j-punct">,</span>}
      </div>
    );
  }

  const entries = entriesOf(value);
  const [openBracket, closeBracket] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  if (entries.length === 0) {
    return (
      <div className="j-line" style={indent}>
        {label}
        <span className="j-punct">
          {openBracket}
          {closeBracket}
          {comma && ','}
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="j-line j-toggle" style={indent} onClick={() => setOpen(!open)}>
        <span className={open ? 'j-caret open' : 'j-caret'} aria-hidden />
        {label}
        {open ? (
          <span className="j-punct">{openBracket}</span>
        ) : (
          <>
            <span className="j-preview">{preview(value)}</span>
            {comma && <span className="j-punct">,</span>}
            <span className="j-count">{count(value)}</span>
          </>
        )}
      </div>
      {open && (
        <>
          {entries.map(([key, child], i) => (
            <Node
              key={key}
              name={key}
              isIndex={Array.isArray(value)}
              value={child}
              depth={depth + 1}
              comma={i < entries.length - 1}
              expand={expand}
              onOpen={onOpen}
            />
          ))}
          <div className="j-line" style={indent}>
            <span className="j-punct">
              {closeBracket}
              {comma && ','}
            </span>
          </div>
        </>
      )}
    </>
  );
};

/** `expand` opens (`true`) or closes (`false`) every level; remount with a new `key` to apply it. */
export const JsonView = ({
  value,
  expand,
  onOpen,
}: {
  value: unknown;
  expand?: boolean;
  onOpen: (href: string) => void;
}) => (
  <div className="json">
    <Node value={value as Json} depth={0} comma={false} expand={expand} onOpen={onOpen} />
  </div>
);
