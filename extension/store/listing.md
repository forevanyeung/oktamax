# Chrome Web Store listing

Paste these into the Developer Dashboard. The store shows plain text, so the description below
uses no Markdown. Images: `npm run store-assets` writes them to `store/upload/`.

## Store listing

**Summary** (from the manifest, 132 characters at most): `description` in `package.json`.

**Category:** Developer Tools · **Language:** English

**Description:**

```text
See every Okta setting, even as a read-only admin.

Okta's Read-Only Administrator role hides much of your org's configuration, because many settings only show up in the Edit dialog. Okta Max puts a 👁 wherever Okta leaves out Edit. It opens the exact form a super admin would see, with every field locked, using the access you already have. Check what's live without breaking GitOps.

READ-ONLY VIEWS
• App assignments, with the groups behind them by priority
• SAML settings
• Group rules and network zones
• Authentication, global session and password policy rules
• Authenticator settings, even where Okta hides the Actions menu
• The raw API response, for the fields no form shows

Your role doesn't change: Okta Max only reads, and Okta itself rejects any change you try.

AI ASSISTANT
Ask your org a question in plain English and get the answer next to the page you're on. You choose where it runs:
• On-device: Gemini Nano, the AI built into Chrome, and Okta's MCP server run inside the browser. No server, no keys, and nothing leaves your computer.
• Your server: deploy the open-source example server to your own infrastructure and use Claude or any other model, for multi-step answers and tables across every org.

API CONSOLE
Open the API drawer on any admin console page, or press Ctrl + `. It's already signed in as you, so there's no token to create and nothing to paste.
• Endpoint suggestions from Okta's API reference
• IDs filled in from the page: on a user's page, {userId} is that user
• Pretty, table, raw and header views
• Paging, one-click CSV export of every page, and request history

DARK MODE
A dark mode for the whole admin console: Light, Dark, or follow your system.

FOR IT
Set Okta Max up for every admin through Chrome policy (Google Admin, Intune, Jamf or Group Policy). Settings pushed by policy apply as soon as the extension loads.

PRIVATE BY DESIGN
Okta Max runs in your browser and uses your existing admin console session. No accounts, no sign-up, no API tokens, and no analytics. Data only leaves your computer if you point the assistant at a server you run.

Free and open source: https://github.com/forevanyeung/oktamax

Okta Max is not affiliated with or endorsed by Okta, Inc.
```

**Graphic assets** (all in `store/upload/`):

| Field                           | File                                    |
| ------------------------------- | --------------------------------------- |
| Store icon, 128×128             | `icon-128.png`                          |
| Screenshots, 1280×800, in order | `screenshot-1-…` to `screenshot-5-…`    |
| Small promo tile, 440×280       | `promo-small-440x280.png`               |
| Marquee promo tile, 1400×560    | `promo-marquee-1400x560.png` (optional) |

**Official URL:** none · **Homepage URL:** https://forevanyeung.github.io/oktamax/ ·
**Support URL:** https://github.com/forevanyeung/oktamax/issues

## Privacy

**Single purpose:**

```text
Okta Max makes the Okta admin console more useful for read-only admins: read-only views of settings Okta hides behind Edit, an API console, dark mode and an optional assistant, all on admin console pages.
```

**Permission justifications:**

| Permission                                                                             | Justification                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                              | Saves the user's settings (theme, assistant mode, chat server URL), API console history, chat history and cached dark-mode CSS, and reads settings an organization sets through Chrome policy.                  |
| `identity`                                                                             | Signs the admin in to Okta (OAuth with PKCE via `chrome.identity.launchWebAuthFlow`) when they use a chat server their organization runs, so the server can call Okta as them.                                  |
| `offscreen`                                                                            | The on-device assistant runs Okta's MCP server (Python on Pyodide, bundled in the package) in a Web Worker started from an offscreen document, because a service worker can't start workers itself.             |
| Host permissions (Okta domains)                                                        | The content scripts run only on Okta admin console pages (`*-admin.okta.com` and Okta's other domains) to add the views, API console and dark mode, and to exchange tokens with the org's authorization server. |
| Optional host permissions `https://*/*`, `http://localhost/*` and `http://127.0.0.1/*` | Requested at runtime, only for the one origin of the chat server the admin enters in the popup (a server their organization runs, or one on their own machine), so the extension can reach it.                  |

**Remote code:** No, I am not using remote code. All JavaScript and WebAssembly (Pyodide and its
packages) is in the package; the CSP adds only `'wasm-unsafe-eval'` for the bundled `.wasm` files.

**Data usage:** declare what applies to how you'll distribute it. With only the on-device assistant,
nothing leaves the browser. If admins use a chat server, page context and the Okta data the assistant
reads go to that server, which their organization runs:

- Personally identifiable information (Okta user names and emails in answers)
- Authentication information (Okta tokens sent to the chat server)
- Website content (the admin console page sent as context)

Then tick all three certifications (not sold, not used for unrelated purposes, not used for
creditworthiness).

**Privacy policy URL:** required once any data use is declared; the site doesn't have one yet.
