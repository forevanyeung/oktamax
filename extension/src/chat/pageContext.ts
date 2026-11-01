/** Describe the admin console page the admin is on, for the model. */
import type { PageContext } from '@oktamax/shared';

/** Okta object IDs: a 3-character type prefix + 17 characters (00u users, 0oa apps, ...). */
const OKTA_ID = /\b(?:00[a-z]|0o[a-z]|0p[a-z]|rst|nzo|aus|dae|aut|0ho)[A-Za-z0-9]{17}\b/g;
const MAX_TEXT = 8_000;

const visibleText = (el: Element) =>
  (el as HTMLElement).innerText?.replace(/\n{3,}/g, '\n\n').trim() ?? '';

export function capturePageContext(): PageContext {
  const main =
    document.querySelector('main, [role="main"], #content, .content-container') ?? document.body;
  const headings = [...document.querySelectorAll('h1, h2, h3')]
    .filter((h) => h.getClientRects().length > 0)
    .map((h) => visibleText(h))
    .filter(Boolean)
    .slice(0, 20);
  const text = visibleText(main);

  return {
    url: location.href,
    title: document.title,
    headings,
    objectIds: [...new Set(location.href.match(OKTA_ID) ?? [])],
    selection: document.getSelection()?.toString().trim().slice(0, 2_000) || undefined,
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
  };
}
