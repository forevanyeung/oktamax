/** Renders an extension page into its #root. */
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Reuses the page's root, kept on its element: in dev, hot reloading runs the page's
 * module again, and React warns when the same container gets a second root.
 */
export function renderRoot(page: ReactNode) {
  const container = document.getElementById('root') as HTMLElement & { reactRoot?: Root };
  (container.reactRoot ??= createRoot(container)).render(page);
}
