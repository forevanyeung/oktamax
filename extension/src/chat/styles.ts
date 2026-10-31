/** Chat styles, scoped to the extension's shadow root. Colors follow Okta's Odyssey tokens. */
export const CHAT_CSS = `
.launcher, .panel {
  --primary: #1662dd; --primary-hover: #0f4bad; --text: #1d1d21; --muted: #6e6e78;
  --border: #d7d7dc; --surface: #f4f4f6; --error: #d93934;
  font: 14px/1.5 "Public Sans", -apple-system, "Segoe UI", sans-serif;
  color: var(--text);
  position: fixed; right: 24px; bottom: 24px; z-index: 2147483000;
}
.launcher {
  padding: 12px 20px; border: 0; border-radius: 24px; background: var(--primary); color: #fff;
  font-weight: 600; cursor: pointer; box-shadow: 0 4px 16px rgb(29 29 33 / 24%);
}
.launcher:hover { background: var(--primary-hover); }

.panel {
  width: 420px; height: min(640px, calc(100vh - 48px)); display: flex; flex-direction: column;
  background: #fff; border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 8px 32px rgb(29 29 33 / 24%); overflow: hidden;
}
.panel-header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.panel-header h2 { flex: 1; margin: 0; font-size: 16px; font-weight: 600; }
.icon-button { border: 0; background: none; color: var(--muted); cursor: pointer; padding: 4px 8px; border-radius: 6px; font: inherit; }
.icon-button:hover { background: var(--surface); color: var(--text); }

.banner { padding: 12px 16px; color: var(--muted); }
.banner.error { color: var(--error); background: #fdf0ef; }
.signin { padding: 24px 16px; }
.muted { color: var(--muted); font-size: 12px; }

.thread { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.viewport { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.welcome p { margin: 0 0 12px; color: var(--muted); }
.suggestion {
  display: block; width: 100%; margin-bottom: 8px; padding: 8px 12px; text-align: left; cursor: pointer;
  border: 1px solid var(--border); border-radius: 8px; background: #fff; color: var(--text); font: inherit;
}
.suggestion:hover { border-color: var(--primary); }

.message { max-width: 100%; overflow-wrap: anywhere; }
.message.user {
  align-self: flex-end; max-width: 85%; padding: 8px 12px; border-radius: 12px 12px 4px 12px;
  background: var(--primary); color: #fff; white-space: pre-wrap;
}
.message-error { color: var(--error); font-size: 12px; }

.md > :first-child { margin-top: 0; }
.md > :last-child { margin-bottom: 0; }
.md p, .md ul, .md ol { margin: 0 0 8px; }
.md ul, .md ol { padding-left: 20px; }
.md code { background: var(--surface); padding: 1px 4px; border-radius: 4px; font-size: 12px; }
.md pre { background: var(--surface); padding: 8px; border-radius: 6px; overflow-x: auto; }
.md pre code { padding: 0; }
.md table { border-collapse: collapse; margin: 0 0 8px; font-size: 13px; display: block; overflow-x: auto; }
.md th, .md td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; }
.md th { background: var(--surface); }
.md a { color: var(--primary); }

.tool { margin: 4px 0; font-size: 12px; color: var(--muted); }
.tool summary { cursor: pointer; display: flex; align-items: center; gap: 6px; }
.tool pre { max-height: 200px; overflow: auto; background: var(--surface); padding: 8px; border-radius: 6px; font-size: 11px; white-space: pre-wrap; }
.tool-error summary { color: var(--error); }
.tool-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); }
.spinner { width: 10px; height: 10px; border: 2px solid var(--border); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.typing { display: flex; gap: 4px; padding: 4px 0; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite; }
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }

.composer { display: flex; gap: 8px; align-items: flex-end; padding: 12px 16px; border-top: 1px solid var(--border); }
.composer-input {
  flex: 1; resize: none; max-height: 160px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px;
  font: inherit; color: var(--text); outline: none;
}
.composer-input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgb(22 98 221 / 20%); }
.composer-button {
  padding: 8px 16px; border: 1px solid var(--border); border-radius: 8px; background: #fff;
  color: var(--text); font: inherit; font-weight: 600; cursor: pointer;
}
.composer-button.primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.composer-button.primary:hover { background: var(--primary-hover); }
.composer-button:disabled { opacity: 0.5; cursor: default; }
`;
