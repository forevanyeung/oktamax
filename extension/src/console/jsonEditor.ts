/**
 * The Body tab's JSON editor (CodeMirror): highlighting, brackets and quotes
 * that close themselves, completions for the body's keys and values, field
 * descriptions on hover, and problems underlined as it's typed. Loaded only
 * when the Body tab opens.
 */
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  snippet,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { forceLinting, linter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { EditorState, Prec } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { completionsAt, fieldAt, fieldInfo, lintBody, type BodySchema } from './body';
import { keyAt } from './jsonDoc';

export interface JsonEditorOptions {
  parent: HTMLElement;
  doc: string;
  placeholder: string;
  onChange: (doc: string) => void;
  onSend: () => void;
  /** The body's schema, when the URL is an endpoint the spec has one for. */
  schema: () => BodySchema | undefined;
}

export interface JsonEditor {
  setDoc: (doc: string) => void;
  /** Checks the body again, after its schema changes. */
  relint: () => void;
  focus: () => void;
  destroy: () => void;
}

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--j-key)' },
  { tag: tags.string, color: 'var(--j-string)' },
  { tag: tags.number, color: 'var(--j-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--j-literal)', fontWeight: '600' },
  {
    tag: [tags.separator, tags.brace, tags.squareBracket, tags.punctuation],
    color: 'var(--muted)',
  },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--canvas)', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '18px', overflow: 'auto' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--text)' },
  '.cm-line': { padding: '0 10px' },
  '.cm-gutters': {
    border: 'none',
    borderRight: '1px solid var(--border)',
    backgroundColor: 'var(--raised)',
    color: 'var(--muted)',
  },
  '.cm-placeholder': { color: 'var(--muted)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--blue) 25%, transparent) !important',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--blue) 20%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--blue) 50%, transparent)',
  },
  '.cm-tooltip': {
    border: '1px solid var(--border)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    boxShadow: 'var(--shadow) 0 6px 18px 0',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--mono)', maxHeight: '16em' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '2px 10px 2px 6px',
    lineHeight: '18px',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--raised)',
    color: 'var(--text)',
  },
  '.cm-completionLabel': { fontWeight: '600' },
  '.cm-completionMatchedText': { color: 'var(--blue)', textDecoration: 'none' },
  '.cm-completionDetail': { marginLeft: '10px', color: 'var(--j-number)', fontStyle: 'normal' },
  '.cm-completionIcon': { width: '14px', paddingRight: '4px', opacity: '0.7' },
  '.cm-tooltip.cm-completionInfo, .cm-body-hover': {
    maxWidth: '360px',
    padding: '6px 10px',
    fontFamily: 'var(--sans)',
    fontSize: '12px',
    lineHeight: '17px',
    whiteSpace: 'pre-line',
  },
  '.cm-body-hover-head': { fontFamily: 'var(--mono)', fontWeight: '600' },
  '.cm-body-hover-type': { marginLeft: '8px', color: 'var(--j-number)', fontWeight: '400' },
  '.cm-body-hover-required': { marginLeft: '8px', color: 'var(--post)', fontSize: '11px' },
  '.cm-body-hover-desc': { marginTop: '2px', color: 'var(--muted)' },
  '.cm-diagnostic': { padding: '4px 8px', fontFamily: 'var(--sans)', fontSize: '12px' },
});

function complete(schema: () => BodySchema | undefined) {
  return (context: CompletionContext) => {
    const current = schema();
    if (!current) return null;
    const text = context.state.doc.toString();
    const result = completionsAt(text, context.pos, current);
    // Only while typing a key or value, unless asked for (Ctrl + Space).
    if (!result || (!context.explicit && !result.typing)) return null;
    // Options match what's typed after the quote, and replace the quote too.
    const quote = result.quoted ? 1 : 0;
    return {
      from: result.from + quote,
      // Matched against what's typed up to the cursor, not the quote after it.
      to: context.pos,
      options: result.options.map((option): Completion => ({
        label: option.label,
        displayLabel: option.display,
        detail: option.required ? `${option.detail} · required` : option.detail,
        info: option.info,
        type: option.kind,
        boost: option.required ? 1 : 0,
        apply: (view, completion, from, to) => {
          // The closing quote the editor added goes too.
          const end = quote && view.state.sliceDoc(to, to + 1) === '"' ? to + 1 : to;
          snippet(option.snippet)(view, completion, from - quote, end);
        },
      })),
      validFor: /^[\w$@.-]*$/,
    };
  };
}

function hover(schema: () => BodySchema | undefined) {
  return hoverTooltip((view, pos) => {
    const current = schema();
    if (!current) return null;
    const key = keyAt(view.state.doc.toString(), pos);
    const field = key && fieldAt(current, key.path);
    if (!key || !field) return null;
    return {
      pos: key.from,
      end: key.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-body-hover';
        const head = dom.appendChild(document.createElement('div'));
        head.className = 'cm-body-hover-head';
        head.textContent = field.p;
        const type = head.appendChild(document.createElement('span'));
        type.className = 'cm-body-hover-type';
        type.textContent = field.t;
        if (field.r) {
          const required = head.appendChild(document.createElement('span'));
          required.className = 'cm-body-hover-required';
          required.textContent = 'required';
        }
        const info = fieldInfo(field);
        if (info) {
          const desc = dom.appendChild(document.createElement('div'));
          desc.className = 'cm-body-hover-desc';
          desc.textContent = info;
        }
        return { dom };
      },
    };
  });
}

/** JSON syntax errors first; once it parses, the body's problems against its schema. */
function lint(schema: () => BodySchema | undefined) {
  const syntax = jsonParseLinter();
  return linter(
    (view): Diagnostic[] => {
      const text = view.state.doc.toString();
      if (!text.trim()) return [];
      const errors = syntax(view);
      if (errors.length) return errors;
      const current = schema();
      return current ? lintBody(text, current) : [];
    },
    { delay: 250 },
  );
}

export function createJsonEditor(options: JsonEditorOptions): JsonEditor {
  let syncing = false;
  const view = new EditorView({
    parent: options.parent,
    state: EditorState.create({
      doc: options.doc,
      extensions: [
        lineNumbers(),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        EditorState.tabSize.of(2),
        indentUnit.of('  '),
        json(),
        syntaxHighlighting(highlight),
        autocompletion({ override: [complete(options.schema)], icons: false }),
        hover(options.schema),
        lint(options.schema),
        placeholder(options.placeholder),
        EditorView.contentAttributes.of({ 'aria-label': 'Request body', spellcheck: 'false' }),
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-Enter',
              run: () => {
                options.onSend();
                return true;
              },
            },
          ]),
        ),
        keymap.of([
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...lintKeymap,
          ...historyKeymap,
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) options.onChange(update.state.doc.toString());
        }),
        theme,
      ],
    }),
  });

  return {
    setDoc(doc) {
      if (doc === view.state.doc.toString()) return;
      syncing = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
      syncing = false;
    },
    relint: () => forceLinting(view),
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
