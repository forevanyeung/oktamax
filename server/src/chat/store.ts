/**
 * Chat persistence. The server owns the history so the extension can reload on
 * every admin console navigation and pick up exactly where it was.
 *
 * In-memory for now; implement `ChatStore` on DynamoDB/Postgres for production.
 */
import type { UIMessage } from 'ai';

import type { ChatMessageMetadata } from '@oktamax/shared';
import type { StreamBuffer } from '@oktamax/shared/streamBuffer';

export type ChatMessage = UIMessage<ChatMessageMetadata>;

export interface Chat {
  id: string;
  /** Okta user ID of the admin who owns this chat. */
  ownerId: string;
  messages: ChatMessage[];
  updatedAt: number;
  /** The response currently being generated, if any. */
  active?: StreamBuffer;
}

export interface ChatStore {
  get(id: string): Chat | undefined;
  save(chat: Chat): void;
}

export class MemoryChatStore implements ChatStore {
  private chats = new Map<string, Chat>();

  get(id: string) {
    return this.chats.get(id);
  }

  save(chat: Chat) {
    chat.updatedAt = Date.now();
    this.chats.set(chat.id, chat);
  }
}
