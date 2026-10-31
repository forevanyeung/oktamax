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

const MarkdownText = () => <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="md" />;

/** "search_users" → "Search users" */
const toolLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');

/** Every Okta lookup the model made, collapsed by default. */
const ToolCall: ToolCallMessagePartComponent = ({ toolName, args, result, status, isError }) => {
  const running = status.type === 'running';
  return (
    <details className={`tool ${isError ? 'tool-error' : ''}`}>
      <summary>
        <span className={running ? 'spinner' : 'tool-dot'} aria-hidden />
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
  <MessagePrimitive.Root className="message user">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="message assistant">
    <MessagePrimitive.Parts components={{ Text: MarkdownText, tools: { Fallback: ToolCall } }} />
    <MessagePrimitive.Error>
      <div className="message-error">The response failed. Try again.</div>
    </MessagePrimitive.Error>
  </MessagePrimitive.Root>
);

export const Thread = ({ onStop }: { onStop: () => void }) => {
  const running = useAuiState((s) => s.thread.isRunning);

  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="viewport">
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="welcome">
            <p>
              Ask about this org’s configuration. I can look things up with your read-only access,
              and I know which page you’re on.
            </p>
            {SUGGESTIONS.map((prompt) => (
              <ThreadPrimitive.Suggestion key={prompt} prompt={prompt} send className="suggestion">
                {prompt}
              </ThreadPrimitive.Suggestion>
            ))}
          </div>
        </AuiIf>

        <ThreadPrimitive.Messages>
          {({ message }) => (message.role === 'user' ? <UserMessage /> : <AssistantMessage />)}
        </ThreadPrimitive.Messages>

        <AuiIf condition={(s) => s.thread.isRunning}>
          <div className="typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        </AuiIf>
      </ThreadPrimitive.Viewport>

      <ComposerPrimitive.Root className="composer">
        <ComposerPrimitive.Input
          className="composer-input"
          placeholder="Ask about this org…"
          submitMode="enter"
          autoFocus
        />
        {running ? (
          <button type="button" className="composer-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <ComposerPrimitive.Send className="composer-button primary">Send</ComposerPrimitive.Send>
        )}
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  );
};
