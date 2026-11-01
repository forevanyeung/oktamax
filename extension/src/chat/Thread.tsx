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

import {
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
  type PageToolInput,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

import { runPageAction, useConsoleOff } from './pageActions';

const SUGGESTIONS = [
  'Explain what I’m looking at on this page',
  'Which apps don’t require MFA?',
  'Bring up today’s sign-ins to this app',
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

/** A page action: what was opened, and a button to open it again. */
const PageTool: ToolCallMessagePartComponent = ({ toolCallId, toolName, args, result, status }) => {
  const output = result as PageToolOutput | undefined;
  const consoleOff = useConsoleOff(toolCallId);
  const navigate = toolName === NAVIGATE;
  if (status.type === 'running' || !output) {
    return (
      <div className="chat-action">
        <span className="chat-spinner" aria-hidden />
        {navigate ? 'Opening a page' : 'Opening in the API console'}
      </div>
    );
  }
  if (!output.ok) {
    return (
      <div className="chat-action failed">
        Couldn’t open <code>{(args as PageToolInput).path}</code>: {output.error}
      </div>
    );
  }
  return (
    <div className="chat-action">
      <span className="chat-action-icon" aria-hidden>
        {navigate ? '→' : '{ }'}
      </span>
      <span className="chat-action-label" title={output.path}>
        {navigate ? 'Went to ' : 'Opened in the API console: '}
        <code>{output.path}</code>
      </span>
      <button
        type="button"
        className="chat-text-button"
        onClick={() => runPageAction(toolCallId, toolName, output.path)}
      >
        {navigate ? 'Go again' : 'Open again'}
      </button>
      {consoleOff && (
        <span className="chat-action-note">
          The API console is turned off. Turn on “Show the API console” in the Okta Max popup.
        </span>
      )}
    </div>
  );
};

const UserMessage = () => (
  <MessagePrimitive.Root className="chat-message user">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root className="chat-message assistant">
    <MessagePrimitive.Parts
      components={{
        Text: MarkdownText,
        tools: {
          by_name: { [OPEN_IN_API_CONSOLE]: PageTool, [NAVIGATE]: PageTool },
          Fallback: ToolCall,
        },
      }}
    />
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
