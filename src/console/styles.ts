/**
 * The API console drawer. Shares the dialog's colors (`form/styles.ts`), and
 * adds code and HTTP method colors, after Postman's.
 */
import { DARK } from '../theme/palette';

const BODY_FONT = `Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
const MONO_FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

export const consoleStyles = `
:host {
  --raised: #f4f4f5; --hover: #ededed; --canvas: #fafafa;
  --get: #007f31; --post: #ad7a03; --put: #0053b8; --patch: #623497; --delete: #8e1a10;
  --j-key: #a1260d; --j-string: #0a7a3f; --j-number: #0053b8; --j-literal: #8a3ab9;
}
:host([data-theme='dark']) {
  --raised: ${DARK.raised}; --hover: ${DARK.hover}; --canvas: ${DARK.canvas};
  --get: #6bdd9a; --post: #ffc95c; --put: #74aef6; --patch: #c09aff; --delete: #f79a8e;
  --j-key: #9cdcfe; --j-string: #ce9178; --j-number: #b5cea8; --j-literal: #c586c0;
}

.drawer-tab {
  position: fixed; z-index: 2147482000; bottom: 0; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px; padding: 4px 16px 3px;
  border: 1px solid var(--border); border-bottom: 0; border-radius: 8px 8px 0 0;
  background: var(--surface); box-shadow: var(--shadow) 0 -2px 8px 0;
  font: 600 12px/18px ${BODY_FONT}; color: var(--muted); cursor: pointer;
}
.drawer-tab:hover { color: var(--blue); }
.drawer-tab .chevron {
  width: 6px; height: 6px; margin-top: 3px;
  border: solid currentColor; border-width: 2px 0 0 2px; transform: rotate(45deg);
}

.drawer {
  box-sizing: border-box; position: fixed; z-index: 2147482000; left: 0; right: 0; bottom: 0;
  display: flex; flex-direction: column;
  border-top: 1px solid var(--border); background: var(--surface);
  box-shadow: var(--shadow) 0 -6px 24px 0;
  font: 400 13px/20px ${BODY_FONT}; color: var(--text); text-align: left;
}
.drawer *, .drawer *::before, .drawer *::after { box-sizing: border-box; }
.drawer button, .drawer input, .drawer select, .drawer textarea { font: inherit; color: inherit; }
.drawer code { font-family: ${MONO_FONT}; font-size: 12px; }
.grip {
  position: absolute; top: -4px; left: 0; right: 0; height: 9px; cursor: ns-resize; touch-action: none;
}
.grip::after {
  content: ''; position: absolute; top: 2px; left: 50%; width: 40px; height: 4px; margin-left: -20px;
  border-radius: 2px; background: var(--border);
}
.grip:hover::after { background: var(--blue); }

.drawer .hint { margin: 0; color: var(--muted); }
.spacer { flex: 1; }

.drawer button { border: 0; background: none; cursor: pointer; }
.drawer button:disabled { opacity: 0.5; cursor: default; }
.drawer button:focus-visible, .drawer input:focus-visible, .drawer select:focus-visible,
.drawer textarea:focus-visible { outline: none; box-shadow: var(--focus) 0 0 0 3px; }
.drawer .small {
  padding: 2px 10px; border: 1px solid var(--border); border-radius: 6px;
  font-size: 12px; line-height: 18px;
}
.drawer .small:hover:not(:disabled) { background: var(--hover); }
.drawer .small.primary { border-color: var(--blue); color: var(--blue); font-weight: 600; }
.drawer .icon {
  width: 24px; height: 24px; padding: 0; border-radius: 6px;
  font-size: 18px; line-height: 24px; color: var(--muted);
}
.drawer .icon:hover { background: var(--hover); color: var(--text); }

.drawer-main { display: flex; flex: 1; min-height: 0; }
.history {
  display: flex; flex-direction: column; flex: 0 0 280px; min-width: 0;
  border-right: 1px solid var(--border); background: var(--canvas);
}
.history-head { display: flex; gap: 6px; padding: 8px; }
.filter {
  flex: 1; min-width: 0; padding: 2px 8px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface);
}
.history-list { flex: 1; margin: 0; padding: 0 0 8px; overflow: auto; list-style: none; }
.history-list li { position: relative; }
.history-item {
  display: grid; grid-template-columns: 52px 1fr; width: 100%; padding: 4px 32px 4px 8px;
  text-align: left;
}
.history-item:hover, .history-list li:focus-within .history-item { background: var(--hover); }
.history-url {
  overflow: hidden; font-family: ${MONO_FONT}; font-size: 12px; white-space: nowrap; text-overflow: ellipsis;
}
.history-meta { grid-column: 2; display: flex; gap: 8px; color: var(--muted); font-size: 11px; line-height: 16px; }
.history-meta .code { color: var(--get); font-weight: 600; }
.history-meta .code.fail { color: var(--delete); }
.history .run {
  position: absolute; top: 8px; right: 6px; font-size: 11px; opacity: 0;
}
.history-list li:hover .run, .history .run:focus-visible { opacity: 1; }
.history-empty { padding: 8px; }

.method { font: 700 11px/20px ${MONO_FONT}; }
.m-GET { color: var(--get); }
.m-POST { color: var(--post); }
.m-PUT { color: var(--put); }
.m-PATCH { color: var(--patch); }
.m-DELETE { color: var(--delete); }

.work { display: flex; flex-direction: column; flex: 1; min-width: 0; padding: 10px 12px 0; }
.prompt {
  display: flex; flex: none; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface);
}
.prompt:focus-within { border-color: var(--blue); box-shadow: var(--focus) 0 0 0 3px; }
.method-select {
  flex: none; padding: 0 8px 0 12px; border: 0; border-right: 1px solid var(--border);
  border-radius: 8px 0 0 8px; background: var(--raised);
  font: 700 13px/34px ${MONO_FONT} !important; cursor: pointer;
}
.method-select.m-GET { color: var(--get); }
.method-select.m-POST { color: var(--post); }
.method-select.m-PUT { color: var(--put); }
.method-select.m-PATCH { color: var(--patch); }
.method-select.m-DELETE { color: var(--delete); }
.method-select option { color: var(--text); }
.drawer .method-select:focus-visible { box-shadow: none; }
.drawer .prompt-input {
  flex: 1; min-width: 0; padding: 0 12px; border: 0; background: none;
  font: 13px/34px ${MONO_FONT}; outline: none; box-shadow: none;
}
.drawer .send {
  flex: none; padding: 0 20px; border-radius: 0 7px 7px 0; background: var(--blue);
  color: #fff; font-weight: 600;
}
:host([data-theme='dark']) .drawer .send { background: ${DARK.primary}; }

.prompt-row { display: flex; flex: none; gap: 12px; align-items: center; }
.prompt-wrap { position: relative; flex: 1; min-width: 0; }
.drawer-controls { display: flex; flex: none; gap: 4px; align-items: center; }
.drawer-controls .hint { margin-right: 8px; font-size: 12px; white-space: nowrap; }
.suggestions {
  position: absolute; z-index: 2; top: calc(100% + 4px); left: 0; right: 0;
  max-height: min(320px, 60vh); margin: 0; padding: 4px 0; overflow: auto; list-style: none;
  border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
  box-shadow: var(--shadow) 0 6px 18px 0;
}
.suggestion {
  display: grid; grid-template-columns: 56px minmax(0, max-content) minmax(0, 1fr); gap: 12px;
  align-items: baseline; padding: 3px 12px; cursor: pointer;
}
.suggestion.active { background: var(--raised); }
.suggestion-label {
  overflow: hidden; font: 12px/20px ${MONO_FONT}; white-space: nowrap; text-overflow: ellipsis;
}
.suggestion-label b { color: var(--blue); }
.suggestion-detail {
  overflow: hidden; color: var(--muted); font-size: 12px; white-space: nowrap; text-overflow: ellipsis;
}
.m-param { color: var(--muted); }

.request-tabs, .tabs { display: flex; gap: 2px; }
.request-tabs { align-items: center; }
.drawer .page-object {
  display: inline-flex; gap: 6px; align-items: center; margin-left: 6px; padding: 0 8px 0 0;
  overflow: hidden; border: 1px solid var(--border); border-radius: 4px;
  font: 11px/20px ${MONO_FONT};
}
.drawer .page-object:hover:not(:disabled) { border-color: var(--blue); }
.drawer .page-object:disabled { opacity: 1; }
.page-object-label {
  padding: 0 6px; background: var(--raised); color: var(--muted); font: 600 11px/20px ${BODY_FONT};
}
.request-tabs { flex: none; margin-top: 6px; }
.drawer .tab {
  padding: 4px 10px; border-bottom: 2px solid transparent; color: var(--muted); font-weight: 600;
}
.drawer .tab:hover { color: var(--text); }
.drawer .tab.active { border-bottom-color: var(--blue); color: var(--text); }
.request-panel {
  flex: none; max-height: 50%; overflow: auto; padding: 6px 0 8px; border-bottom: 1px solid var(--border);
}

.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td {
  padding: 3px 8px; border: 1px solid var(--border); text-align: left; vertical-align: top;
}
.grid th { background: var(--raised); color: var(--muted); font-weight: 600; white-space: nowrap; }
.params { max-width: 900px; }
.params td { padding: 0; }
.params td.remove { width: 32px; text-align: center; }
.cell-input {
  width: 100%; padding: 3px 8px; border: 0; background: none;
  font-family: ${MONO_FONT} !important; font-size: 12px !important;
}
.cell-input:focus { outline: none; background: var(--raised); }

.body-editor { display: flex; flex-direction: column; gap: 6px; }
.code-input {
  width: 100%; min-height: 120px; padding: 8px 10px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--canvas); resize: vertical;
  font: 12px/18px ${MONO_FONT} !important; tab-size: 2;
}
.body-bar { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.body-status { color: var(--get); }
.body-status.invalid { color: var(--delete); }
.body-bar .small { margin-left: auto; }

.placeholder { padding: 16px 0; }
.response { display: flex; flex-direction: column; flex: 1; min-height: 0; margin-top: 8px; }
.response-bar {
  display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px 12px;
  padding-bottom: 6px; border-bottom: 1px solid var(--border);
}
.status { padding: 0 8px; border-radius: 4px; font: 700 12px/22px ${MONO_FONT}; }
.status.good { background: color-mix(in srgb, var(--get) 15%, transparent); color: var(--get); }
.status.info { background: color-mix(in srgb, var(--put) 15%, transparent); color: var(--put); }
.status.warn { background: color-mix(in srgb, var(--post) 15%, transparent); color: var(--post); }
.status.bad { background: color-mix(in srgb, var(--delete) 15%, transparent); color: var(--delete); }
.meta { color: var(--muted); font-size: 12px; }
.response-bar .tabs { margin-left: 8px; }
.drawer .response-error { flex: none; margin-top: 8px; padding: 6px 12px; font-size: 12px; }
.response-body { flex: 1; min-height: 0; overflow: auto; padding: 6px 0 12px; }
.response-body .grid td {
  max-width: 320px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  font-family: ${MONO_FONT};
}
.response-body .grid thead th { position: sticky; top: -6px; z-index: 1; }
.response-body .grid .num { width: 1%; color: var(--muted); text-align: right; }
.response-body .headers th { width: 1%; font-family: ${MONO_FONT}; font-weight: 400; }
.response-body .headers td { max-width: none; white-space: normal; overflow-wrap: anywhere; }
.raw-text {
  margin: 0; font: 12px/18px ${MONO_FONT}; white-space: pre-wrap; overflow-wrap: anywhere;
}

.json { font: 12px/19px ${MONO_FONT}; }
.j-line { position: relative; white-space: pre-wrap; overflow-wrap: anywhere; }
.j-toggle { cursor: pointer; }
.j-toggle:hover { background: var(--hover); }
.j-caret {
  position: absolute; top: 6px; width: 0; height: 0; margin-left: -13px;
  border: 4px solid transparent; border-left: 6px solid var(--muted); border-right: 0;
}
.j-caret.open { top: 8px; margin-left: -14px; border: 4px solid transparent; border-top: 6px solid var(--muted); border-bottom: 0; }
.j-key { color: var(--j-key); }
.j-index { color: var(--muted); }
.j-string { color: var(--j-string); }
.j-number { color: var(--j-number); }
.j-literal { color: var(--j-literal); font-weight: 600; }
.j-punct, .j-preview { color: var(--muted); }
.j-count { margin-left: 8px; color: var(--muted); font-style: italic; font-size: 11px; }
.drawer .j-link {
  padding: 0; color: var(--j-string); font: inherit; text-align: left;
  text-decoration: underline dotted; text-underline-offset: 2px;
}
.drawer .j-link:hover { color: var(--blue); text-decoration-style: solid; }
`;
