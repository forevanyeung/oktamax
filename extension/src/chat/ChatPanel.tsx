/**
 * The on-page chat: a launcher button, and a panel that survives page loads.
 *
 * Every admin console navigation reloads this content script. The current chat
 * ID and open/closed state live in extension storage, history is loaded from the
 * server, and an answer that was still streaming is resumed.
 */
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk';
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';

import type { AuthStatus } from '../background/messages';
import { useDrawerInset } from '../console/inset';
import { loadSettings, onSettingsChanged } from '../settings';
import { useChatState } from './chatState';
import { CHAT_CSS } from './styles';
import { Thread } from './Thread';
import { isAdminConsoleOf, useAuth } from './useAuth';
import { useChatHistory, useOktaChat, type OktaChatMessage } from './useOktaChat';

// Keep typing in the chat from triggering the admin console's keyboard shortcuts.
const isolateKeys = (event: KeyboardEvent) => event.stopPropagation();

const GAP = 24;
const MAX_HEIGHT = 640;
/** Below this, the panel covers the API console instead of squeezing in above it. */
const MIN_HEIGHT = 240;
const LAUNCHER_HEIGHT = 44;

/** Sits above the API console drawer when it's open and leaves room, else in the corner. */
const usePlacement = () => {
  const inset = useDrawerInset();
  const above = (height: number) => inset > 0 && innerHeight - inset - GAP * 1.5 >= height;
  const bottom = (height: number) => (above(height) ? inset + GAP / 2 : GAP);
  const panelBottom = bottom(MIN_HEIGHT);
  return {
    launcher: { bottom: bottom(LAUNCHER_HEIGHT) } satisfies CSSProperties,
    panel: {
      bottom: panelBottom,
      height: `min(${MAX_HEIGHT}px, calc(100vh - ${panelBottom + GAP}px))`,
    } satisfies CSSProperties,
  };
};

const ChatIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M2.5 3.5h11v7.5H8l-3 2.5V11H2.5z" strokeLinejoin="round" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
  </svg>
);

const Conversation = ({
  serverUrl,
  chatId,
  initialMessages,
}: {
  serverUrl: string;
  chatId: string;
  initialMessages: OktaChatMessage[];
}) => {
  const chat = useOktaChat(serverUrl, chatId, initialMessages);
  const runtime = useAISDKRuntime(chat);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {chat.error && (
        <div className="chat-banner chat-failed" role="alert">
          {chat.error.message.includes('signin_required')
            ? 'Your session expired. Close and reopen the chat to sign in again.'
            : chat.error.message}
        </div>
      )}
      <Thread onStop={() => void chat.stop()} />
    </AssistantRuntimeProvider>
  );
};

const ChatBody = ({ serverUrl, chatId }: { serverUrl: string; chatId: string }) => {
  const { messages, error } = useChatHistory(serverUrl, chatId);
  if (error)
    return (
      <div className="chat-banner chat-failed" role="alert">
        {error}
      </div>
    );
  if (!messages) return <div className="chat-banner">Loading…</div>;
  return (
    <Conversation key={chatId} serverUrl={serverUrl} chatId={chatId} initialMessages={messages} />
  );
};

const Panel = ({
  children,
  style,
  mock,
  onClose,
  onNewChat,
}: {
  children: ReactNode;
  style: CSSProperties;
  mock: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}) => (
  <section
    className="chat-panel"
    role="dialog"
    aria-label="Okta assistant"
    style={style}
    onKeyDown={(event) => {
      isolateKeys(event);
      if (event.key === 'Escape') onClose();
    }}
    onKeyUp={isolateKeys}
  >
    <header className="chat-header">
      <h2>Okta assistant</h2>
      {mock && (
        <span className="chat-tag" title="Dev build without a chat server: replies are canned">
          Mock
        </span>
      )}
      {onNewChat && (
        <button type="button" className="chat-text-button" onClick={onNewChat}>
          New chat
        </button>
      )}
      <button
        type="button"
        className="chat-icon-button"
        onClick={onClose}
        aria-label="Close"
        title="Close (Esc)"
      >
        <CloseIcon />
      </button>
    </header>
    {children}
  </section>
);

const useChatServerUrl = () => {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    void loadSettings().then((s) => setUrl(s.chatServerUrl));
    onSettingsChanged((s) => setUrl(s.chatServerUrl));
  }, []);
  return url;
};

/** What the panel shows when it can't chat yet: the server isn't set up, or the admin isn't signed in. */
const Notice = ({
  status,
  onSignIn,
  onRetry,
}: {
  status: AuthStatus;
  onSignIn: () => void;
  onRetry: () => void;
}) =>
  status.state === 'unreachable' ? (
    <div className="chat-notice">
      <p>
        <strong>The assistant isn’t set up yet.</strong> It needs a chat server, and there’s none at{' '}
        <code>{status.serverUrl}</code>.
      </p>
      <p>
        Ask whoever runs Okta Max for your organization for the server’s URL, then set it in the
        Okta Max toolbar popup.
      </p>
      <p className="chat-note">{status.error}</p>
      <button type="button" className="chat-button" onClick={onRetry}>
        Try again
      </button>
    </div>
  ) : (
    <div className="chat-notice">
      <p>
        Sign in with Okta to use the assistant. It reads your org with your own, read-only access.
      </p>
      {status.state === 'signedOut' && status.error && <p className="chat-note">{status.error}</p>}
      <button type="button" className="chat-button primary" onClick={onSignIn}>
        Sign in
      </button>
    </div>
  );

export const ChatLauncher = () => {
  const serverUrl = useChatServerUrl();
  const { state, setOpen, startNewChat } = useChatState();
  const { status, signIn, refresh } = useAuth(serverUrl);
  const placement = usePlacement();

  if (!serverUrl || !state || !status || status.state === 'off') return null;
  // Only on the admin console of the org the chat server serves.
  if ('oktaOrgUrl' in status && !isAdminConsoleOf(status.oktaOrgUrl)) return null;
  const canChat = status.state === 'signedIn' || status.state === 'mock';

  return (
    <div className="chat">
      <style>{CHAT_CSS}</style>
      {state.open ? (
        <Panel
          style={placement.panel}
          mock={status.state === 'mock'}
          onClose={() => setOpen(false)}
          onNewChat={canChat ? startNewChat : undefined}
        >
          {canChat ? (
            <ChatBody serverUrl={serverUrl} chatId={state.chatId} />
          ) : (
            <Notice status={status} onSignIn={() => void signIn()} onRetry={refresh} />
          )}
        </Panel>
      ) : (
        <button
          type="button"
          className="chat-launcher"
          style={placement.launcher}
          onClick={() => setOpen(true)}
          aria-label="Open Okta assistant"
        >
          <ChatIcon />
          Ask
        </button>
      )}
    </div>
  );
};
