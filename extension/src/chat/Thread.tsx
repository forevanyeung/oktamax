/**
 * The conversation view, built from assistant-ui's unstyled primitives (styles
 * in `styles.ts`).
 */
import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';

const SUGGESTIONS = [
  'Explain what I’m looking at on this page',
  'Which apps don’t require MFA?',
  'Who has been locked out in the last 24 hours?',
];

const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="chat-md" />
);

/** "search_users" → "Search users" */
const toolLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');

/** Every Okta lookup the model made, collapsed by default. */
const ToolCall: ToolCallMessagePartComponent = ({ toolName, args, result, status, isError }) => {
  const running = status.type === 'running';
  return (
    <details className={`chat-tool ${isError ? 'failed' : ''}`}>
      <summary>
        <span className={running ? 'chat-spinner' : 'chat-tool-dot'} aria-hidden />
        {running ? 'Looking up' : 'Looked up'}: {toolLabel(toolName)}
      </summary>
      <pre>{JSON.stringify(args, null, 2)}</pre>
      {result !== undefined && (
        <pre>{typeof result === 'string' ? result : JSON.stringify(result, null, 2)}</pre>
      )}
    </details>
  );
};

const UserMessage = () => (
  <MessagePrimitive.Root className="chat-message user">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="chat-message assistant">
    <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCall } }} />
    <MessagePrimitive.Error>
      <div className="chat-message-error">The response failed. Try again.</div>
    </MessagePrimitive.Error>
  </MessagePrimitive.Root>
);

export const Thread = ({ onStop }: { onStop: () => void }) => {
  const running = useAuiState((s) => s.thread.isRunning);

  return (
    <ThreadPrimitive.Root className="chat-thread">
      <ThreadPrimitive.Viewport className="chat-viewport">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="chat-welcome">
            <p>
              Ask about this org’s configuration. I can look things up with your read-only access,
              and I know which page you’re on.
            </p>
            {SUGGESTIONS.map((prompt) => (
              <ThreadPrimitive.Suggestion
                key={prompt}
                prompt={prompt}
                send
                className="chat-starter"
              >
                {prompt}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </AuiIf>

        <ThreadPrimitive.Messages>
          {({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage />)}
        </ThreadPrimitive.Messages>

        <AuiIf condition={(s) => s.thread.isRunning}>
          <div className="chat-typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        </AuiIf>
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="chat-composer">
        <ComposerPrimitive.Input
          className="chat-input"
          placeholder="Ask about this org…"
          submitMode="enter"
          autoFocus
        />
        {running ? (
          <button type="button" className="chat-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <ComposerPrimitive.Send className="chat-button primary">Send</ComposerPrimitive.Send>
        )}
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
};
