/**
 * The on-page chat: a launcher button, and a panel that survives page loads.
 *
 * Every admin console navigation reloads this content script. The current chat
 * ID and open/closed state live in extension storage, history is loaded from the
 * server, and an answer that was still streaming is resumed.
 */
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

import { loadSettings, onSettingsChanged } from '../settings';
import { useChatState } from './chatState';
import { CHAT_CSS } from './styles';
import { Thread } from './Thread';
import { isAdminConsoleOf, useAuth } from './useAuth';
import { useChatHistory, useOktaChat, type OktaChatMessage } from './useOktaChat';

// Keep typing in the chat from triggering the admin console's keyboard shortcuts.
const isolateKeys = (event: KeyboardEvent) => event.stopPropagation();

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
        <div className="banner error">
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
  if (error) return <div className="banner error">{error}</div>;
  if (!messages) return <div className="banner">Loading…</div>;
  return (
    <Conversation key={chatId} serverUrl={serverUrl} chatId={chatId} initialMessages={messages} />
  );
};

const Panel = ({
  children,
  onClose,
  onNewChat,
}: {
  children: ReactNode;
  onClose: () => void;
  onNewChat?: () => void;
}) => (
  <section
    className="panel"
    role="dialog"
    aria-label="Okta assistant"
    onKeyDown={isolateKeys}
    onKeyUp={isolateKeys}
  >
    <header className="panel-header">
      <h2>Okta assistant</h2>
      {onNewChat && (
        <button type="button" className="icon-button" onClick={onNewChat}>
          New chat
        </button>
      )}
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
        ✕
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

export const ChatLauncher = () => {
  const serverUrl = useChatServerUrl();
  const { state, setOpen, startNewChat } = useChatState();
  const { status, signIn } = useAuth();

  // Only on the admin console of the org the chat server serves.
  if (!serverUrl || !state || !status?.configured) return null;
  if (status.oktaOrgUrl && !isAdminConsoleOf(status.oktaOrgUrl)) return null;

  return (
    <>
      <style>{CHAT_CSS}</style>
      {state.open ? (
        <Panel
          onClose={() => setOpen(false)}
          onNewChat={status.signedIn ? startNewChat : undefined}
        >
          {status.signedIn ? (
            <ChatBody serverUrl={serverUrl} chatId={state.chatId} />
          ) : (
            <div className="signin">
              <p>
                Sign in with Okta to use the assistant. It reads your org with your own, read-only
                access.
              </p>
              {status.error && <p className="muted">{status.error}</p>}
              <button
                type="button"
                className="composer-button primary"
                onClick={() => void signIn()}
              >
                Sign in
              </button>
            </div>
          )}
        </Panel>
      ) : (
        <button
          type="button"
          className="launcher"
          onClick={() => setOpen(true)}
          aria-label="Open Okta assistant"
        >
          Ask
        </button>
      )}
    </>
  );
};
