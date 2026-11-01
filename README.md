<img src="assets/logo.svg" width="96" alt="Okta Max logo">

# Okta Max

A Chrome extension for **read-only Okta admins**. Read-only admins can call the same `GET` APIs the
admin console uses, but much of that data only appears in dialogs behind an **Edit** button, which
the console hides from them. Wherever that button is missing, this extension adds a 👁 icon where
the Edit button would be. It opens the same form, laid out and styled like Okta's own edit dialog,
with every field read-only. Settings the
console already shows read-only admins on the page (App Settings, Sign On settings, OIDC settings,
policy details) don't get one.

- The views only ever send `GET` requests (`src/okta/api.ts` has no other method).
- An **API console** drawer at the bottom of the page sends any request you type to the Okta API
  (see below). It's the only part of the extension that can send something other than `GET`.
- Uses the admin's existing session. No tokens, no extra permissions beyond `storage`.
- The UI is rendered in a shadow DOM, so it can't break the admin console's styles (or the reverse).

## Install

```sh
npm install
npm run build          # vp build → dist/
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick `dist/`.

`npm run dev` (`vp dev`) builds with hot reload. Load `dist/` once in the same way.

### Staying up to date on another machine

Dev mode loads the extension's code from the local dev server, so the browser picks up changes
without reloading anything in `chrome://extensions`:

```sh
git clone https://github.com/forevanyeung/oktamax.git && cd oktamax
npm ci
npm run dev            # leave running; load dist/ as unpacked once
```

After that, `git pull` is enough: the dev server rebuilds and the extension reloads itself.

The toolbar popup has two settings:

- **Admin console theme**: Light, Dark, or System (follows the OS, the default). Dark mode recolors
  the whole admin console, keeping Okta's own colors and hues with a dark mood.
- **Show view icons next to Edit buttons too**: turn it on as a full admin to compare the view
  dialogs with the real edit dialogs side by side.
- **Show the API console**: the drawer described below (on by default).

Where Edit is an item of an **Actions** menu, a **View** item is added to the same menu (its tooltip
says it comes from Okta Max).

## What's covered

| Admin console page                   | Edit dialog it mirrors                        |
| ------------------------------------ | --------------------------------------------- |
| Applications › app › General         | SAML Settings (Edit SAML Integration)         |
| Applications › app › Assignments     | Edit User Assignment, Edit Group Assignment   |
| Directory › Groups › Rules           | Edit Rule                                     |
| Security › Networks                  | Edit Zone (IP, dynamic, enhanced dynamic)     |
| Security › Authentication Policies   | Edit Rule                                     |
| Security › Global Session Policy     | Edit Rule                                     |
| Security › Authenticators › Password | Edit Rule                                     |
| Security › Authenticators            | Authenticator settings (rendered generically) |

Every dialog also has a collapsed **API response (JSON)** section, for fields the form doesn't map.

## API console

Pull up the **API** tab at the bottom of any admin console page (or press `Ctrl` + `` ` ``) for a
small Postman: a prompt that sends requests to this org's API with your session.

- Type a path and press Enter: `/api/v1/users?limit=5`. Paths without a leading slash are under
  `/api/v1/` (`groups?q=Everyone`), and pasted full URLs keep only their path, so requests always
  go to the org you're on.
- As you type, the prompt suggests endpoints from Okta's API reference (the Management API's
  OpenAPI spec): paths, query parameters after `?`, or endpoints whose summary has the words you
  type (`list group members`). ↓ / Tab / Enter pick one, Esc closes the list, `Ctrl` + Space opens
  it.
- Path parameters like `{userId}`, `{groupId}`, `{appId}`, `{policyId}` or `{authServerId}` are
  filled in from the page you're on, like rockstar: on a user's page, suggestions use that user's
  ID, and `/api/v1/users/{userId}/groups` is sent for that user. With an empty prompt, the
  suggestions are the page's objects' endpoints. The page's objects are also shown next to
  Params / Body; click one to browse its endpoints.
- Pick the method from the menu, or type it first (`post groups`). `POST`, `PUT`, `PATCH` and
  `DELETE` send Okta's XSRF token like the console does, so they work with your admin role's
  permissions. A read-only admin gets a 403.
- **Params** edits the query string as a table; **Body** takes JSON (Format, `⌘/Ctrl` + Enter to
  send).
- The response shows its status, time and size, and has four views: **Pretty** (a collapsible,
  colored JSON tree; `_links` start collapsed, and API links in it open with a click), **Table**
  (for lists: one row per object, with nested fields like `profile.login` as columns), **Raw** and
  **Headers**. Okta error summaries are shown above it, and **Next page** follows the `Link`
  header.
- **History** keeps the last 100 requests (in `chrome.storage.local`). Click one to load it, ▶ to
  send it again, or press ↑ / ↓ at the prompt. Drag the drawer's top edge to resize it, or expand
  it as tall as it goes with the button next to ×, by double-clicking that edge, or by pressing
  `Ctrl` + `` ` `` twice quickly.

The endpoint list (`src/console/endpoints.json`) is generated from
[Okta's spec](https://github.com/okta/okta-management-openapi-spec): run `npm run endpoints` to
update it.

## How it works

```
src/
  console/           the API console drawer: requests, history, endpoint suggestions, JSON tree
                     and table views
  content/
    index.tsx        entry point: mounts the dialog host and starts the scanner
    theme.iife.ts    turns dark mode on and off with the setting
    pageWorld.iife.ts page-world hooks: keeps loads dark until dark mode is ready
    scanner.ts       re-scans on DOM/URL changes; adds/removes view buttons
    dom.ts           finds sections by heading text and rows by object name; detects Edit controls
    viewHost.tsx     shadow DOM + React root (view dialogs and the API console)
    ViewDialog.tsx   loads the data and shows the read-only form
  form/
    schema.ts        declarative form description + builders (text, radio, tags, ...)
    ReadOnlyForm.tsx renders the schema like Okta's edit dialogs, nothing editable
    styles.ts        the dialog CSS, measured from the console's own edit dialogs
  okta/              GET-only API client, ID → name lookups, API types
  theme/
    palette.ts       the dark palette, and how the console's light colors map onto it
    darkMode.ts      rewrites the colors of every stylesheet on the page and adopts the result
  views/             one "provider" per admin console area + the API → form mappings
```

Okta's markup changes often and differs between its legacy and React pages, so the extension
doesn't depend on Okta's CSS classes. A **provider** (`src/views/types.ts`) does three things:

1. `matches(url)`: does this provider apply to the current page?
2. `findTargets(url)`: fetches the objects (rules, zones, ...) and finds them on the page,
   either by **section heading** (`findSections(['SAML Settings'])`) or by **object name**
   (`findItems(rules, r => r.name)`).
3. Each target's `load()`: maps the API response to a form, e.g.

   ```ts
   section('THEN', [
     radio('Access is', signOn.access, {
       ALLOW: 'Allowed after successful authentication',
       DENY: 'Denied',
     }),
     checkboxGroup('Possession factor constraints are', required, POSSESSION_CONSTRAINTS),
   ]);
   ```

A view icon is added unless the target's part of the page already has an Edit control (by text,
`aria-label`, `title`, or `data-se`), either visible or inside a collapsed "Actions" menu. It goes
where Okta puts Edit: the target's optional `actions` element (a row's actions cell, a section's
button bar, which Okta often renders empty for read-only admins), or else after `anchor`.

### Dark mode

Okta's console mixes Odyssey (MUI + emotion), legacy Courage CSS and CSS modules, and its nav shell
lives in shadow roots, so dark mode doesn't restyle widgets one by one. `theme/darkMode.ts` reads
every stylesheet in the document and in each open shadow root (fetching cross-origin ones the CSSOM
won't expose), rewrites each rule's colors with `theme/palette.ts`, and adopts a dark copy of each
sheet after the page's own: same selectors, same order, so the dark color applies exactly where the
light one did. The console's most used colors map to hand-picked dark tokens (`TOKENS`); anything
else is converted by role (background, text, border, shadow) in OKLCH, keeping its hue. SVG
`fill`/`stroke` attributes and inline colors are matched by value.

Avoiding a light flash on page loads takes these pieces:

- Both scripts that run at `document_start` are named `*.iife.ts`, so CRXJS injects them as plain
  scripts. Otherwise it loads content scripts through an async `import()` (in dev, also via the dev
  server for HMR), which lands after the console's first paint. No Chrome API can rewrite a page's
  stylesheets for us (`content_scripts.css` and `registerContentScripts` take only packaged files,
  `scripting.insertCSS` races the first paint, and `declarativeNetRequest` can't change response
  bodies), so timing the content scripts is what matters.
- `content/pageWorld.iife.ts` runs in the page's JS world. If the console was dark last time (a
  flag in the console's `localStorage`), it adopts a sheet that paints the canvas dark and hides the
  page until dark mode is ready (at most 1.5 s).
- It also announces `insertRule` calls (emotion) and new shadow roots, which don't show up as DOM
  mutations, so dark mode updates in a microtask, before the browser renders the new rules.
- Converted CSS of Okta's CDN stylesheets is cached in `chrome.storage.local`, keyed by their
  content-hashed URLs, so on later loads they're dark before they've even downloaded. The cache is
  dropped whenever `src/theme/` changes (a hash set in `vite.config.ts`) and isn't kept in dev.

### Adding a page

Create `src/views/<area>.ts` that exports a `ViewProvider` (`groupRules.ts` is the smallest
example), add it to `src/views/index.ts`, and add a unit test under `src/views/__tests__/`.

## Development

```sh
npm run check      # vp check: format + lint
npm run typecheck
npm test           # vp test: unit tests for the API → form mappings
npm run test:e2e   # builds, loads the extension in Chromium against a mock admin page
```

The e2e test (`e2e/smoke.ts`) needs Playwright's Chromium (`npx playwright install chromium`).
Branded Chrome no longer accepts `--load-extension`. The test checks that icons only appear
where Edit is missing, that inputs/selects/checkboxes can't be changed, that the views only send
`GET` requests, and that the API console sends requests (with the XSRF token for `POST`) and keeps
their history. Screenshots are saved to `e2e/*.png`.

### Testing against a real org

`e2e/okta.ts`, `e2e/seed.ts` and `e2e/live.ts` drive a real Okta org (an integrator org works).
Put two accounts, a super admin and a read-only admin, both enrolled in Google Authenticator, in
a git-ignored `.env` at the repo root:

```sh
OKTA_ADMIN_URL=https://<org>-admin.okta.com
OKTA_USERNAME_ADMIN=...
OKTA_PASSWORD_ADMIN='...'      # quote values that contain #
OKTA_TOTP_SECRET_ADMIN=...     # base32 secret shown when enrolling Google Authenticator
OKTA_USERNAME_READ=...
OKTA_PASSWORD_READ='...'
OKTA_TOTP_SECRET_READ=...
```

```sh
npx vpx e2e/okta.ts            # check both accounts can sign in (sessions are kept in e2e/.profiles)
npx vpx e2e/seed.ts            # as the super admin, create "Oktamax …" test objects (re-runnable)
npm run build && npx vpx e2e/live.ts   # as the read-only admin, open every view; screenshots in e2e/live/
```

The seed only creates new objects, and scopes its policies to a test group or test app. Policy
changes are Okta "protected actions", so the scripts answer the step-up pop-up with the admin's
password and TOTP code.

## Known limitations

- The field labels and their order follow Okta's edit dialogs as closely as possible and have been
  checked against a live integrator org (console version 2026.42). Okta changes labels and URL
  paths over time; if one differs (`POLICY_PAGES` in `views/policies/index.ts`, a section
  heading, a label), it's a one-line change in the matching view.
- On policy pages with no policy ID in the URL, the selected policy is worked out from the
  visible heading.
- Authenticator settings and OIN app-specific settings vary per integration, so they are shown
  generically (humanized keys) rather than with Okta's exact labels.
