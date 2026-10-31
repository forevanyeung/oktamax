<img src="assets/logo.svg" width="96" alt="Okta Max logo">

# Okta Max

A Chrome extension for **read-only Okta admins**. Read-only admins can call the same `GET` APIs the
admin console uses, but much of that data only appears in dialogs behind an **Edit** button, which
the console hides from them. Wherever that button is missing, this extension adds a 👁 icon where
the Edit button would be. It opens the same form, laid out and styled like Okta's own edit dialog,
with every field read-only. Settings the
console already shows read-only admins on the page (App Settings, Sign On settings, OIDC settings,
policy details) don't get one.

- Only ever sends `GET` requests (`src/okta/api.ts` has no other method).
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

The toolbar popup has one setting: **show view icons next to Edit buttons too**. Turn it on as a
full admin to compare the view dialogs with the real edit dialogs side by side. Where Edit is an item
of an **Actions** menu, a **View** item is added to the same menu (its tooltip says it comes from Okta Max).

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

## How it works

```
src/
  content/
    index.tsx        entry point: mounts the dialog host and starts the scanner
    scanner.ts       re-scans on DOM/URL changes; adds/removes view buttons
    dom.ts           finds sections by heading text and rows by object name; detects Edit controls
    viewHost.tsx     shadow DOM + React root
    ViewDialog.tsx   loads the data and shows the read-only form
  form/
    schema.ts        declarative form description + builders (text, radio, tags, ...)
    ReadOnlyForm.tsx renders the schema like Okta's edit dialogs, nothing editable
    styles.ts        the dialog CSS, measured from the console's own edit dialogs
  okta/              GET-only API client, ID → name lookups, API types
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
where Edit is missing, that inputs/selects/checkboxes can't be changed, and that only `GET`
requests are sent. Screenshots are saved to `e2e/*.png`.

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
