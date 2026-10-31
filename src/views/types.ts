import type { FormView } from '../form/schema';

/** One place on the page where Okta would show an Edit button. */
export interface ViewTarget {
  /** Unique per page; used to inject exactly one view button. */
  key: string;
  /** Dialog title, mirroring Okta's edit dialog ("Edit Rule" -> "View Rule"). */
  title: string;
  /** The view button is placed right after this element (a heading or a row's name)... */
  anchor: Element;
  /**
   * ...unless the page has a place for this object's actions (a row's actions cell, a
   * section's button bar). Okta renders some of these empty for read-only admins.
   */
  actions?: Element | null;
  /**
   * Recreates that place where Okta leaves it out entirely for read-only admins (a table
   * without an actions column, a card without its actions section). Only called when the
   * page shows neither an Edit control nor `actions`.
   */
  addActions?: () => Element;
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
