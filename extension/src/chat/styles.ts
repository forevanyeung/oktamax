/**
 * Chat styles. They share the shadow root with the view dialogs and the API
 * console, so every rule is scoped under `.chat`, and colors come from the
 * dialog's theme variables (`form/styles.ts`) to follow dark mode.
 */
import { DARK } from '../theme/palette';

const BODY_FONT = `Inter, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`;
const MONO_FONT = `ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

export const CHAT_CSS = `
.chat {
  /* Filled buttons and the user's bubbles: Okta blue in both themes, under white text. */
  --chat-fill: ${DARK.primary}; --chat-fill-hover: #3b51c4;
  --chat-raised: #f4f4f5; --chat-hover: #ededed;
  font: 400 14px/22px ${BODY_FONT}; color: var(--text); text-align: left;
}
:host([data-theme='dark']) .chat { --chat-raised: ${DARK.raised}; --chat-hover: ${DARK.hover}; }

.chat-launcher, .chat-panel { box-sizing: border-box; position: fixed; z-index: 2147482500; right: 24px; }
.chat-panel *, .chat-panel *::before, .chat-panel *::after { box-sizing: border-box; }
.chat button, .chat textarea { font: inherit; color: inherit; }
.chat button:focus-visible, .chat textarea:focus-visible { outline: none; box-shadow: var(--focus) 0 0 0 3px; }

.chat .chat-launcher {
  display: flex; align-items: center; gap: 8px; padding: 10px 18px 10px 14px;
  border: 0; border-radius: 24px; background: var(--chat-fill); color: #fff;
  font-weight: 600; cursor: pointer; box-shadow: var(--shadow) 0 4px 16px 0;
}
.chat .chat-launcher:hover { background: var(--chat-fill-hover); }
.chat-launcher svg { width: 18px; height: 18px; }

.chat-panel {
  width: 420px; max-width: calc(100vw - 48px); display: flex; flex-direction: column;
  border: 1px solid var(--border); border-radius: 16px; background: var(--surface);
  box-shadow: var(--shadow) 0 6px 24px 0; overflow: hidden;
}
.chat-header {
  display: flex; flex: none; align-items: center; gap: 4px; padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--border);
}
.chat-header h2 { flex: 1; margin: 0; font: 600 16px/24px Aeonik, ${BODY_FONT}; }
.chat .chat-text-button {
  padding: 2px 10px; border: 1px solid var(--border); border-radius: 6px; background: none;
  font-size: 12px; line-height: 18px; cursor: pointer;
}
.chat .chat-text-button:hover { background: var(--chat-hover); }
.chat .chat-icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none;
  color: var(--muted); cursor: pointer;
}
.chat .chat-icon-button:hover { background: var(--chat-hover); color: var(--text); }
.chat-icon-button svg { width: 14px; height: 14px; }

.chat-banner { flex: none; margin: 12px 16px 0; padding: 8px 12px; border-radius: 6px; color: var(--muted); }
.chat-banner.chat-failed { background: var(--error-bg); color: var(--error-text); }
.chat-tag {
  margin-right: auto; padding: 0 8px; border: 1px solid var(--chip-border); border-radius: 10px;
  background: var(--chip); color: var(--muted); font-size: 11px; font-weight: 600; line-height: 18px;
}
.chat-header h2:has(+ .chat-tag) { flex: none; }
.chat-notice { padding: 24px 16px; overflow-y: auto; }
.chat-notice p { margin: 0 0 12px; }
.chat-notice code { padding: 1px 4px; border-radius: 4px; background: var(--chat-raised); font: 12px ${MONO_FONT}; overflow-wrap: anywhere; }
.chat-notice .chat-note { margin-bottom: 16px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }

.chat-thread { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.chat-viewport {
  flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.chat-welcome p { margin: 0 0 12px; color: var(--muted); }
.chat .chat-starter {
  display: block; width: 100%; margin-bottom: 8px; padding: 8px 12px; text-align: left; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px; background: none;
}
.chat .chat-starter:hover { border-color: var(--blue); color: var(--blue); }

.chat-message { max-width: 100%; overflow-wrap: anywhere; }
.chat-message.user {
  align-self: flex-end; max-width: 85%; padding: 8px 12px; border-radius: 12px 12px 4px 12px;
  background: var(--chat-fill); color: #fff; white-space: pre-wrap;
}
.chat-message.user p { margin: 0; }
.chat-message-error { color: var(--error-text); font-size: 12px; }

.chat-md > :first-child { margin-top: 0; }
.chat-md > :last-child { margin-bottom: 0; }
.chat-md p, .chat-md ul, .chat-md ol { margin: 0 0 8px; }
.chat-md ul, .chat-md ol { padding-left: 20px; }
.chat-md h1, .chat-md h2, .chat-md h3, .chat-md h4 { margin: 12px 0 6px; font-size: 14px; font-weight: 600; }
.chat-md code { padding: 1px 4px; border-radius: 4px; background: var(--chat-raised); font: 12px ${MONO_FONT}; }
.chat-md pre { padding: 8px; border-radius: 6px; background: var(--chat-raised); overflow-x: auto; }
.chat-md pre code { padding: 0; background: none; }
.chat-md table { display: block; margin: 0 0 8px; overflow-x: auto; border-collapse: collapse; font-size: 13px; }
.chat-md th, .chat-md td { padding: 4px 8px; border: 1px solid var(--border); text-align: left; }
.chat-md th { background: var(--chat-raised); font-weight: 600; }
.chat-md a { color: var(--blue); }

.chat-tool { margin: 4px 0; color: var(--muted); font-size: 12px; }
.chat-tool summary { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.chat-tool pre {
  max-height: 200px; margin: 6px 0 0; padding: 8px; overflow: auto; border-radius: 6px;
  background: var(--chat-raised); font: 11px/16px ${MONO_FONT}; white-space: pre-wrap;
}
.chat-tool.failed summary { color: var(--error-text); }
.chat-tool-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.chat-spinner {
  width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--blue);
  border-radius: 50%; animation: chat-spin 0.8s linear infinite;
}
@keyframes chat-spin { to { transform: rotate(360deg); } }

.chat-typing { display: flex; gap: 4px; padding: 4px 0; }
.chat-typing span {
  width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: chat-blink 1.2s infinite;
}
.chat-typing span:nth-child(2) { animation-delay: 0.2s; }
.chat-typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes chat-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

.chat-composer {
  display: flex; flex: none; gap: 8px; align-items: flex-end; padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.chat .chat-input {
  flex: 1; max-height: 160px; padding: 7px 12px; resize: none;
  border: 1px solid var(--border); border-radius: 8px; background: var(--surface);
}
.chat .chat-input:focus-visible { border-color: var(--blue); }
.chat .chat-input::placeholder { color: var(--muted); }
.chat .chat-button {
  padding: 7px 16px; border: 1px solid var(--border); border-radius: 8px; background: none;
  font-weight: 600; cursor: pointer;
}
.chat .chat-button:hover:not(:disabled) { background: var(--chat-hover); }
.chat .chat-button.primary { border-color: var(--chat-fill); background: var(--chat-fill); color: #fff; }
.chat .chat-button.primary:hover:not(:disabled) { background: var(--chat-fill-hover); }
.chat .chat-button:disabled { opacity: 0.5; cursor: default; }

@media (prefers-reduced-motion: reduce) {
  .chat-spinner, .chat-typing span { animation-duration: 0s; }
}
`;
