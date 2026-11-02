/**
 * Which chat is current and whether the panel is open – kept in extension
 * storage so it survives admin console page loads and is shared across tabs.
 */
import { useEffect, useState } from 'react';

export interface ChatState {
  chatId: string;
  open: boolean;
}

const KEY = 'chatState';

const newChat = (): ChatState => ({ chatId: crypto.randomUUID(), open: true });

const save = (state: ChatState) => chrome.storage.local.set({ [KEY]: state });

export function useChatState() {
  const [state, setState] = useState<ChatState>();

  useEffect(() => {
    void chrome.storage.local.get(KEY).then((stored) => {
      setState((stored[KEY] as ChatState | undefined) ?? { ...newChat(), open: false });
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[KEY]?.newValue) setState(changes[KEY].newValue as ChatState);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const update = (next: ChatState) => {
    setState(next);
    void save(next);
  };

  return {
    state,
    setOpen: (open: boolean) => state && update({ ...state, open }),
    startNewChat: () => update(newChat()),
  };
}
