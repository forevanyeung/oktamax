/**
 * How much of the bottom of the viewport the open drawer covers, so the chat
 * can sit above it instead of on top of the response.
 */
import { useSyncExternalStore } from 'react';

let inset = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setDrawerInset = (height: number) => {
  if (height === inset) return;
  inset = height;
  listeners.forEach((l) => l());
};

export const useDrawerInset = () => useSyncExternalStore(subscribe, () => inset);
