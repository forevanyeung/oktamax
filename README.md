# Okta Read-Only View

A Chrome extension for **read-only Okta admins**. Read-only admins can call the same `GET` APIs the
admin console uses, but much of that data only appears in dialogs behind an **Edit** button, which
the console hides from them. Wherever that button is missing, this extension adds a 👁 icon. It
opens the same form, built with Okta's own [Odyssey](https://github.com/okta/odyssey) design system,
with every field read-only.

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

The toolbar popup has one setting: **show view icons next to Edit buttons too**. Turn it on as a
full admin to compare the view dialogs with the real edit dialogs side by side.

## What's covered

| Admin console page                   | Edit dialog it mirrors                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Applications › app › General         | App Settings, SAML Settings (Edit SAML Integration), OIDC Client Credentials / General Settings / Login |
| Applications › app › Sign On         | Settings (sign-on method, credentials details)                                                          |
| Directory › Groups › Rules           | Edit Rule                                                                                               |
| Security › Networks                  | Edit Zone (IP, dynamic, enhanced dynamic)                                                               |
| Security › Authentication Policies   | Edit Rule (and policy name/description/groups)                                                          |
| Security › Global Session Policy     | Edit Rule, Edit Policy                                                                                  |
| Security › Authenticators › Password | Edit Rule, Edit Policy (complexity, age, lockout)                                                       |
| Security › Authenticators            | Authenticator settings (rendered generically)                                                           |

Every dialog also has a collapsed **API response (JSON)** section, for fields the form doesn't map.

## How it works

```
src/
  content/
    index.tsx        entry point: mounts the dialog host and starts the scanner
    scanner.ts       re-scans on DOM/URL changes; adds/removes view buttons
    dom.ts           finds sections by heading text and rows by object name; detects Edit controls
    viewHost.tsx     shadow DOM + OdysseyProvider
    ViewDialog.tsx   loads the data and shows the read-only form
  form/
    schema.ts        declarative form description + builders (text, radio, tags, ...)
    ReadOnlyForm.tsx renders the schema with Odyssey components, all `isReadOnly`
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

A view icon is added unless the target's part of the page already has a visible Edit control
(by text, `aria-label`, `title`, or `data-se`).

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

## Known limitations

- The field labels and their order follow Okta's edit dialogs as closely as possible, but they
  were written without access to a live tenant. If a label, URL path (`POLICY_PAGES` in
  `views/policies/index.ts`) or section heading differs in your org, it's a one-line change in
  the matching view.
- On policy pages with no policy ID in the URL, the selected policy is worked out from the
  visible heading.
- Authenticator settings and OIN app-specific settings vary per integration, so they are shown
  generically (humanized keys) rather than with Okta's exact labels.
