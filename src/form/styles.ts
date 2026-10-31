/**
 * The look of Okta's admin console edit dialogs, measured from the live
 * console (version 2026.42). Lives in our shadow root, so it can't leak into
 * the page; the page's Inter / Aeonik web fonts still apply inside it.
 */
import { DARK } from '../theme/palette';

const BLUE = 'var(--blue)';
const TEXT = 'var(--text)';
const MUTED = 'var(--muted)';
const BORDER = 'var(--border)';
const SURFACE = 'var(--surface)';

const BODY_FONT = `Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
const HEADING_FONT = `Aeonik, ${BODY_FONT}`;

const CHECK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath fill='white' d='M0 5.6L1.6 4l3.2 3.3 5.6-5.7L12 3.1l-7.2 7.4L0 5.6z'/%3E%3C/svg%3E")`;

export const dialogStyles = `
:host {
  --blue: #4c64e1; --text: #272727; --muted: #6e6e6e; --border: #cbcbcb; --surface: #fff;
  --focus: #9daaf1; --scrim: rgba(39, 39, 39, 0.75); --shadow: rgba(39, 39, 39, 0.2);
  --callout: #e1e1e1; --chip: #f4f4f5; --chip-border: #d7d7dc;
  --error-bg: #fbeaea; --error-text: #a1191d;
}
:host([data-theme='dark']) {
  color-scheme: dark;
  --blue: ${DARK.link}; --text: ${DARK.text}; --muted: ${DARK.muted}; --border: ${DARK.borderStrong};
  --surface: ${DARK.surface}; --focus: ${DARK.focus}; --scrim: rgba(0, 0, 0, 0.7);
  --shadow: rgba(0, 0, 0, 0.5); --callout: ${DARK.hover}; --chip: ${DARK.raised};
  --chip-border: ${DARK.borderStrong}; --error-bg: ${DARK.errorBg}; --error-text: ${DARK.errorText};
}
.overlay {
  position: fixed; inset: 0; z-index: 2147483000;
  background: var(--scrim);
}
.dialog {
  position: fixed; z-index: 2147483001; top: 50%; left: 50%; transform: translate(-50%, -50%);
  box-sizing: border-box; max-width: 100vw; max-height: 100vh; overflow: auto;
  padding: 12px; border-radius: 16px; background: ${SURFACE};
  box-shadow: var(--shadow) 0 6px 24px 0;
  font: 400 14px/24px ${BODY_FONT}; color: ${TEXT}; text-align: left;
}
.dialog *, .dialog *::before, .dialog *::after { box-sizing: border-box; }
.title { margin: 0; padding: 12px; font: 600 24.4px/31.7px ${HEADING_FONT}; }
.content { padding: 12px; }
.description { margin: 0 0 24px; }
.buttons { display: flex; justify-content: flex-end; padding: 12px; }
.button-clear {
  padding: 6px 12px; border: 1px solid transparent; border-radius: 6px; background: none;
  font: 600 14px/24px ${BODY_FONT}; color: ${BLUE}; cursor: pointer;
}
.button-clear:hover { text-decoration: underline; }
.button-clear:focus-visible { outline: none; box-shadow: var(--focus) 0 0 0 4px; }

.section + .section { padding-top: 24px; border-top: 1px solid ${BORDER}; }
.section-head { margin: 0 0 24px; font: 600 16px/21px ${HEADING_FONT}; }
.section-description { margin: -12px 0 24px; }

.row { display: flex; margin: 0 0 24px; }
.label { flex: 0 0 38%; }
.label.boxed { padding-top: 7px; }
.input { flex: 1; min-width: 0; padding-left: 24px; }
.callout {
  display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 6px; background: var(--callout);
}
.hint { margin: 0; color: ${MUTED}; }
.input > .box + .box { margin-top: 12px; }
.input > .box + .hint, .inline + .hint, [role='radiogroup'] + .hint { margin-top: 4px; }
.note p { margin: 0; }
.note ul { margin: 0; padding-left: 20px; }

.box {
  display: block; width: 100%; min-height: 38px; padding: 6px 12px;
  border: 1px solid ${BORDER}; border-radius: 6px; background: ${SURFACE};
  font: inherit; color: inherit; overflow-wrap: anywhere;
}
input.box, textarea.box { outline: none; }
input.box:focus, textarea.box:focus { border-color: ${BLUE}; box-shadow: var(--focus) 0 0 0 4px; }
textarea.box { min-height: 48px; padding-bottom: 12px; resize: none; }
.select { position: relative; padding-right: 36px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.select::after {
  content: ''; position: absolute; top: 16px; right: 14px;
  border: 4px solid transparent; border-top: 5px solid ${MUTED}; border-bottom: 0;
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px; }
.chip { padding: 0 6px; border: 1px solid var(--chip-border); border-radius: 4px; background: var(--chip); }
.empty { color: ${MUTED}; }
.inline { display: flex; gap: 12px; align-items: flex-start; }
.inline > * { flex: 1; }
.table-row { display: flex; gap: 12px; }
.table-row + .table-row { margin-top: 12px; }
.table-row > * { flex: 1; min-width: 0; }
.table-head { color: ${MUTED}; }

.option { position: relative; margin: 0 0 12px; padding-left: 28px; }
.option:last-child { margin-bottom: 0; }
.option::before {
  content: ''; position: absolute; top: 4px; left: 0; width: 16px; height: 16px;
  border: 2px solid ${BORDER}; background: ${SURFACE};
}
.radio::before { border-radius: 50%; }
.checkbox::before { border-radius: 4px; }
.radio.checked::before { border-color: ${BLUE}; background: radial-gradient(${SURFACE} 0 3px, ${BLUE} 3.5px); }
.checkbox.checked::before {
  border-color: ${BLUE}; background: ${BLUE} ${CHECK} center / 10px no-repeat;
}
.option .hint { margin-top: 0; }

.raw { margin-top: 24px; padding-top: 24px; border-top: 1px solid ${BORDER}; }
.raw summary { color: ${BLUE}; font-weight: 600; cursor: pointer; }
.raw pre { max-height: 400px; margin: 12px 0 0; overflow: auto; font-size: 12px; line-height: 18px; }
.error { padding: 12px; border-radius: 6px; background: var(--error-bg); color: var(--error-text); }
`;
