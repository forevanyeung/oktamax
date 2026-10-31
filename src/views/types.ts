import type { FormView } from '../form/schema';

/** One place on the page where Okta would show an Edit button. */
export interface ViewTarget {
  /** Unique per page; used to inject exactly one view button. */
  key: string;
  /** Dialog title, mirroring Okta's edit dialog ("Edit Rule" -> "View Rule"). */
  title: string;
  /** The view button is placed right after this element (a heading or a row's name). */
  anchor: Element;
  /** The area Okta renders its Edit control in. If it has one, no view button is needed. */
  scope: Element;
  /** Fetch the data and describe the read-only form. Only called when the button is clicked. */
  load: () => Promise<FormView>;
}

/**
 * Knows about one area of the admin console (apps, group rules, policies, ...).
 *
 * `findTargets` is called whenever the page changes, so it must be cheap:
 * list API calls are cached by `okta/api`, and expensive per-item calls belong
 * in `ViewTarget.load`.
 */
export interface ViewProvider {
  name: string;
  matches: (url: URL) => boolean;
  findTargets: (url: URL) => Promise<ViewTarget[]>;
}
