<img src="extension/assets/logo.svg" width="96" alt="Okta Max logo">

# Okta Max

A Chrome extension for **read-only Okta admins**. Read-only admins can call the same `GET` APIs the
admin console uses, but much of that data only appears in dialogs behind an **Edit** button, which
the console hides from them. Wherever that button is missing, this extension adds a 👁 icon where
the Edit button would be. It opens the same form, laid out and styled like Okta's own edit dialog,
with every field read-only. Settings the
console already shows read-only admins on the page (App Settings, Sign On settings, OIDC settings,
policy details) don't get one.

- The views only ever send `GET` requests (`extension/src/okta/api.ts` has no other method).
- An **API console** drawer at the bottom of the page sends any request you type to the Okta API
  (see below). It's the only part of the extension that can send something other than `GET`.
- The views and the API console use the admin's existing session. No tokens.
- The UI is rendered in a shadow DOM, so it can't break the admin console's styles (or the reverse).
- An optional **assistant** (see below): a chat panel backed by Claude (on Amazon Bedrock or Anthropic's API) and Okta's
  own [MCP server](https://github.com/okta/okta-mcp-server), hosted for many admins and limited to
  read-only tools. It knows which page you're on, and keeps going when you navigate. It's the only
  part that needs a server.

```
extension/   Chrome extension (Vite+ · CRXJS · React · assistant-ui)
server/      Chat API + multi-user gateway to Okta's MCP server (Hono · Vercel AI SDK · Bedrock/Anthropic · MCP SDK)
shared/      Types shared by both (page context, chat API, OAuth scopes)
```

## Install

```sh
npm install
npm run build -w @oktamax/extension   # vp build → extension/dist/
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick
`extension/dist/`.

`npm run dev:extension` (`vp dev`) builds with hot reload. Load `extension/dist/` once in the same
way. `npm run dev` runs it together with the chat server (`npm run dev:server`). A dev build is
only a thin loader for the dev server's code, so keep the dev server running while you use it;
without it Chrome reports that the service worker can't be registered. The build points at the
dev server's port, 5273; to run a second checkout alongside, start it with another
`EXTENSION_DEV_PORT` and reload the extension once.

In a dev build, the assistant works without any setup: when no chat server is reachable, the
service worker answers from a mock (`extension/src/background/mockChat.ts`) and the panel is tagged
**Mock**. Its canned replies know the page you're on, stream word by word, keep going across page
loads, and cover the UI's cases: ask about _locked out_ users or apps without _MFA_ (lookups and a
table), to bring up today's _sign-ins_ (opens the System Log, or the API console if you say _API_),
to _go to_ the groups page (navigates), for a _long_ answer (markdown), or for an _error_.
Production builds don't include the mock.

### Staying up to date on another machine

Dev mode loads the extension's code from the local dev server, so the browser picks up changes
without reloading anything in `chrome://extensions`:

```sh
git clone https://github.com/forevanyeung/oktamax.git && cd oktamax
npm ci
npm run dev:extension  # leave running; load extension/dist/ as unpacked once
```

After that, `git pull` is enough: the dev server rebuilds and the extension reloads itself.

The toolbar popup has these settings:

- **Admin console theme**: Light, Dark, or System (follows the OS, the default). Dark mode recolors
  the whole admin console, keeping Okta's own colors and hues with a dark mood.
- **Show view icons next to Edit buttons too**: turn it on as a full admin to compare the view
  dialogs with the real edit dialogs side by side.
- **Show the API console**: the drawer described below (on by default).
- **Chat server URL**: where the assistant's server runs (default `http://localhost:8787`). Chrome
  asks for permission to reach it. Leave it empty to turn the assistant off.

### Setting the chat server for your organization

The chat server URL can be enforced by policy, so admins don't have to enter it. In the Google Admin
console, go to **Devices › Chrome › Apps & extensions › Users & browsers**, select Okta Max, and
under **Policy for extensions** paste:

```json
{ "chatServerUrl": "https://oktamax.example.com" }
```

An empty string turns the assistant off. A URL set this way overrides the popup setting, which then
shows it read-only. Chrome doesn't ask for permission to reach it; the server's CORS policy already
allows the extension. Other management tools (Intune, Jamf, Group Policy) can set the same
`chatServerUrl` key; its schema is `extension/public/managed_schema.json`.

Where Edit is an item of an **Actions** menu, a **View** item is added to the same menu (its tooltip
says it comes from Okta Max). Where Okta leaves that menu out for read-only admins (Authenticators,
authentication policy rules), an **Actions** menu with just the **View** item takes its place.

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
- Lists can be exported with **Export CSV**: download this page, download all pages (follows the
  `Link` header page by page until the last one; Cancel stops it), or copy this page to the
  clipboard. Every field is a column, at any depth (`credentials.provider.type`), arrays are kept as
  JSON, and `_links` / `_embedded` are left out.
- **History** keeps the last 100 requests (in `chrome.storage.local`). Click one to load it, ▶ to
  send it again, or press ↑ / ↓ at the prompt. Drag the drawer's top edge to resize it, or expand
  it as tall as it goes with the button next to ×, by double-clicking that edge, or by pressing
  `Ctrl` + `` ` `` twice quickly.

The endpoint list (`extension/src/console/endpoints.json`) is generated from
[Okta's spec](https://github.com/okta/okta-management-openapi-spec): run
`npm run endpoints -w @oktamax/extension` to update it.

## Assistant

```
Admin console tab                     Service worker              Server                       Okta / AWS
┌───────────────────────────┐        ┌──────────────────┐        ┌──────────────────────┐
│ chat panel (shadow DOM)   │  port  │ holds the token, │ Bearer │ /api/chats/*          │──▶ Bedrock (Claude)
│ assistant-ui + useChat    │───────▶│ relays requests  │───────▶│   AI SDK streamText   │
│ + page context per message│◀───────│ (streams back)   │◀───────│   MCP client ─┐       │
└───────────────────────────┘        └──────────────────┘   SSE  │ /mcp gateway ◀┘       │
                                                                 │   │ one process per   │
                                                                 │   ▼ admin (stdio)     │
                                                                 │ okta-mcp-server ×N    │──▶ Okta API (as each admin,
                                                                 └──────────────────────┘     read scopes only)
```

- **Auth without a new login.** The extension signs in to an Okta OIDC app with PKCE through
  `chrome.identity`. The admin already has an Okta session, so this is normally silent. The access
  token comes from the org authorization server with **read-only Okta API scopes only**
  (`shared/src/index.ts`). Every Okta call is made with that token, so Okta enforces both the
  scopes and the admin's own role. The admin console session cookie is never read or sent anywhere.
- **The token stays in the service worker.** The page-side chat code calls the server through
  `bridgeFetch`, which hands the request to the service worker. The worker adds the token, but
  only for the configured chat server.
- **The server validates tokens** by introspection: they must be active and issued to this app.
  It keeps chat history per Okta user, and one admin can't open another's chat.
- **Okta's MCP server, hosted for many admins.** See [below](#hosting-oktas-mcp-server-for-many-admins).
  Each org's is a standard MCP server at `/mcp/<org host>`, which admins can also
  [add to their own MCP clients](#using-the-mcp-servers-from-your-own-mcp-client).
- **Page context.** Each message carries the page it was sent from: URL, title, headings, Okta
  IDs in the URL, selected text, and up to 8,000 characters of visible text. The server places this
  in front of that message, not in the system prompt, so earlier turns never change.
- **Surviving navigation.** Each admin console page load re-runs the content script.
  - The current chat ID and whether the panel is open are kept in `chrome.storage.local`.
  - History is loaded from the server.
  - Generation runs server-side, and the server keeps a copy of the in-flight stream. A new page
    replays it from the start and then follows it live (`GET /api/chats/:id/stream`; 204 means
    nothing is running).
  - **Stop** calls `POST /api/chats/:id/stop`, because with resumable streams a dropped connection
    doesn't cancel anything.
- **Acting on the page.** Besides Okta's read tools, the model has two page tools
  (`shared/src/pageTools.ts`). The server only checks their input; the extension carries them out
  when they show up in the reply (`extension/src/chat/pageActions.ts`):
  - `navigate` loads an admin console page, for "take me to…" or "bring up the logs for…" (the
    System Log takes a filter and time range in its URL). The answer carries on on the new page.
    The model prefers this one.
  - `open_in_api_console` opens a `GET /api/...` request in the API console and sends it, when you
    ask for the API or no admin console page shows what you asked for. You get the full response
    with paging, the table view and CSV export.

  Both only take paths on the current org; the API console only sends GETs this way. Each call
  runs once, in the tab you're looking at, and calls already in the history don't run again; the
  chat shows **Open again** / **Go again** for them. The model can't click or type on Okta's pages:
  it reads page text and log data, which others can influence, so that would let them steer an
  admin's clicks.

> Page text, tool results and questions are sent to the model: Bedrock in your AWS account, or
> Anthropic's API if you use an API key. They can include
> user names and emails from the pages and API responses. Make sure that's acceptable before
> rolling this out.

### Hosting Okta's MCP server for many admins

[okta/okta-mcp-server](https://github.com/okta/okta-mcp-server) is built for one person on their
own machine:

- it runs over stdio;
- it signs in once (device flow or a private key) and keeps that token in the OS keyring;
- it picks its tools from `OKTA_SCOPES` at startup.

The gateway (`server/src/mcp/`) hosts it for many admins **without modifying it**:

| Concern                | How it's handled                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whose identity is used | Every `/mcp/<org>` request is authenticated (token introspection at that org) and served by **that admin's own `okta-mcp-server` process** for that org, so Okta applies the admin's own role on every call.                                                                                                                                                   |
| Getting the token in   | `server/python/oktamax_keyring.py` is a keyring backend, selected with keyring's standard `PYTHON_KEYRING_BACKEND` setting. It serves the token from a file that the gateway rewrites before each request. Okta's server reads the keyring on every tool call, so a renewed token is picked up without a restart, and the server never starts its own sign-in. |
| Isolation              | One process per admin, each with its own temporary `HOME` (mode 700) and a minimal environment. The server's AWS credentials and other secrets aren't passed in.                                                                                                                                                                                               |
| Read-only, three ways  | (1) The token only has `okta.*.read` scopes. (2) `OKTA_SCOPES` is set to the read scopes the token actually has, so Okta's server drops its write tools at startup. (3) The gateway only lists, and only forwards calls to, `list_*`/`get_*` tools.                                                                                                            |
| Resources              | Processes are reused across requests, closed after `OKTA_MCP_IDLE_MINUTES` (default 10) of idleness, and capped at `OKTA_MCP_MAX_PROCESSES` (default 50; when full, the least recently used idle one is closed).                                                                                                                                               |
| Start-up               | At startup the server runs `okta-mcp-server` once, so `uvx` has downloaded it and Python before anyone asks (the log says `Okta MCP: ready`). Admins' processes share the server user's uv cache (`UV_CACHE_DIR`, `UV_PYTHON_INSTALL_DIR`) rather than their temporary `HOME`. An admin's process starts when they open the chat, not at their first question. |
| Token lifetime         | `/mcp/<org>` refuses tokens with under 2 minutes left (Okta's server treats a token within 60 s of expiry as expired). The extension renews tokens 10 minutes before they expire; MCP clients are told to refresh theirs (`error="invalid_token"`).                                                                                                            |

Each process is a Python interpreter, roughly 50–100 MB. That's sized for a team of admins, not
thousands of concurrent users.

The tools available with the default scopes are:

- users, groups and group membership;
- applications and the app catalog;
- policies and policy rules;
- device assurance policies;
- the System Log and login failures;
- brands, themes and sign-in/error pages;
- email templates and domains.

`okta-mcp-server` has no tools yet for network zones, authenticators, group rules, identity
providers or authorization servers, so the assistant can't answer questions about those.

### More than one org

One server can serve several orgs (production, preview, test), each with its own OIDC app. List
them in `OKTA_ORGS` as `<org url>=<client id>`, separated by spaces, alongside or instead of
`OKTA_ORG_URL` / `OKTA_CLIENT_ID`:

```sh
OKTA_ORGS="https://acme.okta.com=0oa111 https://acme.oktapreview.com=0oa222"
```

- The assistant uses the org of the admin console it's open on, with a token for that org. The
  **Ask** button doesn't appear on other orgs' admin consoles. The extension sends the org with each
  request (`X-Okta-Org: acme.okta.com`), and the token must come from that org's app.
- Each org gets its own MCP server at `/mcp/<org host>`. A token from one org is refused by
  another's, and an admin of two orgs gets a separate `okta-mcp-server` process for each, so
  answers from one org can never be mixed into another's.
- Chats belong to an admin in one org.

### Using the MCP servers from your own MCP client

Admins can add an org's read-only Okta MCP server to Claude Code, Claude Desktop, Cursor, VS Code
or any MCP client that supports OAuth, outside the assistant. Each org is its own server:

```sh
claude mcp add --transport http okta-acme https://oktamax.example.com/mcp/acme.okta.com
```

The client signs in on first use: a browser page asks whether to allow it, then Okta signs the
admin in (usually silently) with the org's OIDC app. Admins only need the URL; the org's app ID is
on the server. It works for the orgs the server is configured for, and no others: anyone could
otherwise use it to reach any org.

How sign-in works (`server/src/mcp/oauth.ts`), following the
[MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):

- A request without a valid token gets a 401 pointing to
  `/.well-known/oauth-protected-resource/mcp/<org>`. That names this server, at
  `/oauth/<org>`, as the org's authorization server. Okta's own can't register clients on the fly,
  and each client has its own redirect URI.
- Clients register themselves (dynamic client registration). The registration is in the client
  ID, signed with `OAUTH_SECRET`, so nothing is stored. Without `OAUTH_SECRET`, client IDs stop
  working when the server restarts, and clients register again. Redirect URIs must be https,
  `http://localhost` (any port), or an app's own scheme (`cursor://...`).
- **A consent page comes first, every time**, naming the app and where it sends the admin back to.
  Without it, anyone could register a client, send an admin a link, and have their silent Okta
  sign-in hand a token to that client. The consent and Okta's callback only work in the browser
  that was shown the page (a cookie checks it), and the page can't be framed.
- On **Allow**, the admin signs in to Okta with the org's app (PKCE, the read scopes plus
  `offline_access`), redirecting to the server's `/oauth/callback`. The server then gives the
  client a one-time code. The client exchanges it (with its own PKCE verifier) for **Okta's own
  access and refresh tokens**. The access token is the same kind the extension holds: read scopes
  only, limited by the admin's role, and checked by introspection like the extension's.
- Refreshing goes through `/oauth/<org>/token` to Okta, as the org's app.

To allow it, each org's OIDC app also needs:

- the sign-in redirect URI `https://<server>/oauth/callback` (the same for every org);
- the **Refresh Token** grant, so clients don't have to sign in again every hour.

`npm run create-okta-app -w @oktamax/server -- <extension-id> --server https://<server>` sets
both. Set `PUBLIC_URL` when the server is behind a proxy, so the URLs it hands out are the
public ones, and `OAUTH_SECRET` so registrations survive restarts.

> Pending sign-ins and codes are kept in memory for 10 minutes, like chats: with more than one
> instance, route `/oauth/*` to one of them, or move them to a shared store.

### Setup

#### 1. Okta OIDC app

In the Okta org the admins use, either run the script, which does steps 1–3 (and 4 with
`--group`) and prints the `OKTA_CLIENT_ID`:

```sh
OKTA_API_TOKEN=... npm run create-okta-app -w @oktamax/server -- <extension-id> [--group "Okta Admins"]
```

It needs `OKTA_ORG_URL` (from `server/.env`) and an API token from a super admin. Add
`--server https://<server>` so admins can also use the org's MCP server from their own MCP clients
([below](#using-the-mcp-servers-from-your-own-mcp-client)). For more orgs, run it once per org with
that org's `OKTA_ORG_URL`. Or by hand:

1. Create an **OIDC Native** (or SPA) app: Authorization Code with **PKCE**, no client secret.
2. Sign-in redirect URIs, both:
   - `https://<extension-id>.chromiumapp.org/`: where Chrome's sign-in window returns to the
     extension (`chrome.identity.getRedirectURL()`); nothing is loaded from it.
   - `chrome-extension://<extension-id>`: never redirected to, but Okta only accepts token
     requests from a browser whose `Origin` is one of the app's redirect URIs. Without it,
     sign-in fails with "Browser requests to the token endpoint must be part of at least one
     whitelisted redirect_uri".

   The extension ID is shown on `chrome://extensions`. To keep it stable across machines, add a
   `key` to `extension/manifest.config.ts`.

3. **Okta API Scopes** tab: grant the `okta.*.read` scopes listed in `OKTA_SCOPES`.
4. Assign the app to your admins. Okta answers an unassigned admin with an error page, which
   Chrome reports as "Authorization page could not be loaded".
5. Give the app an authentication policy your admins' admin console sign-in satisfies. Otherwise
   the extension's silent sign-in fails and admins are asked to sign in again. Okta doesn't let
   other apps share the Admin Console's policy.

#### 2. Server

```sh
cp server/.env.example server/.env   # OKTA_ORG_URL, OKTA_CLIENT_ID, and a model (below)
npm install
npm run dev:server                   # the server: http://localhost:8787 (needs `uv` on PATH for okta-mcp-server)
```

Or with Docker. The image preinstalls Python 3.13 and `okta-mcp-server`, and runs as a non-root
user:

```sh
docker build -f server/Dockerfile -t oktamax-server .
docker run -p 8787:8787 --env-file server/.env oktamax-server
```

- **Model.** Set `ANTHROPIC_API_KEY` to use Anthropic's API directly; without it, the server uses
  Bedrock. `MODEL_ID` picks the model for either one and defaults to Claude Opus 5.5
  (`claude-opus-5-5` on the API).
  - On Bedrock, `MODEL_ID` defaults to `us.anthropic.claude-opus-5-5`, a US cross-region inference
    profile. Use the ID your account has access to.
  - AWS credentials come from the standard chain (env vars, SSO profile, or an instance/task
    role). They need `bedrock:InvokeModelWithResponseStream` on the model.
- **Chat history and in-flight streams are kept in memory.** That suits a single instance. To run
  more than one, implement `ChatStore` on a database and swap `StreamBuffer` for
  `resumable-stream` on Redis; the routes stay the same.

#### 3. Extension

Build and load the extension as in [Install](#install), then:

1. In the toolbar popup, set **Chat server URL**. It defaults to `http://localhost:8787`, and
   Chrome asks for permission to reach it.
2. The **Ask** button appears only on the admin consoles of the orgs the server is configured for.
   While the server can't be reached, it appears on every admin console, and the panel says the
   assistant isn't set up yet.

### On-device assistant (no server)

The popup's **Assistant** switch has a second mode, **On-device**, that needs no chat server, no
OIDC app and no sign-in: turn it on, download the model, and ask on any org's admin console.

```
Admin console tab            Service worker                        Offscreen document
┌──────────────────┐  port  ┌──────────────────────────────┐ port  ┌────────────────────────────┐
│ chat panel       │───────▶│ the chat server's routes      │──────▶│ Pyodide (CPython on WASM)  │
│ (unchanged)      │◀───────│ AI SDK + Gemini Nano          │◀──────│ okta-mcp-server, unmodified│
│                  │        │ (Prompt API, @browser-ai/core)│  MCP  │                            │
│ Okta API GETs    │◀───────│ GETs to the tab's org only    │◀──────│ the SDK's requests         │
│ (admin's session)│───────▶│                               │──────▶│                            │
└──────────────────┘        └──────────────────────────────┘       └────────────────────────────┘
```

- **The model** is Chrome's built-in Gemini Nano (the Prompt API, stable for extensions since
  Chrome 138), used through `@browser-ai/core`. Questions, page text and Okta data never leave the
  browser. Chrome downloads it once for the whole browser, and every site and extension that uses
  it shares that copy. Chrome only starts the download on a click, so the popup's **Download** button
  opens a tab (`extension/src/model/`) that starts it and shows progress: a popup closes as soon as
  it loses focus, taking the download with it. The popup shows the model's status, and
  `chrome://on-device-internals` shows Chrome's own.
- **Okta's MCP server** is the same `okta-mcp-server` 1.1.7, unmodified. It runs on Pyodide in an
  offscreen document (`extension/src/offscreen/`). The differences from the hosted server are:
  - There's no stdio in a browser, so the bridge feeds MCP JSON-RPC to the server over in-memory
    streams.
  - The Okta SDK's one HTTP method is replaced. Each request goes back to the service worker, which
    has the admin console tab the chat is on send it (`extension/src/content/oktaGet.ts`), with
    the admin's session, like the console's own calls and the API console's.
  - There's no access token. The server still checks for one before it starts, so a keyring
    backend hands it a placeholder that's never sent anywhere.
  - pycryptodomex and jwcrypto, used only for private-key sign-in, are stubbed.

- **The org** is the admin console the chat is on: `acme-admin.okta.com` is `acme.okta.com`'s.
  Switching orgs restarts the MCP server, which takes a few seconds.
- **Read-only, without read-only scopes.** The session has the admin's full rights, so reading is
  enforced at every step instead:
  - `OKTA_SCOPES` lists only read scopes, so the server drops its write tools.
  - Only `list_*`/`get_*` tools are given to the model, as on the chat server's gateway.
  - The service worker only passes on GETs to the tab's org.
  - The tab only sends GETs under `/api/`, without the XSRF token Okta requires for changes.

  The assistant can see whatever the admin can, rather than only what the OIDC app's scopes allow.

- **Everything is bundled.** `npm run pyodide -w @oktamax/extension`, which the build runs when
  `public/pyodide/` is missing, resolves the server's dependencies with micropip. It vendors
  Pyodide and 59 wheels, about 26 MB, so nothing is downloaded at runtime: the Chrome Web Store
  doesn't allow remote code. The extension's CSP adds `'wasm-unsafe-eval'` for that and nothing
  else.
- **It needs the admin console open**, which it always is while chatting: the panel lives there.

What it costs:

- **A guide in front of Okta's MCP server** (`extension/src/background/guide.ts`). The evals showed
  Nano can't use okta-mcp-server's 47 read tools directly: picking from them took up to 30 s, and it
  made up IDs and filter syntax that Okta rejects. So Nano gets about ten simple tools that take
  names and fixed choices, such as `group_members({group: "Oktamax Engineering"})` or
  `policies({type: "password"})`. Each one calls okta-mcp-server's tools, which still make every Okta
  call:
  - they look up IDs from names, write Okta's filters, and return only what an answer needs, with
    a one-sentence summary;
  - which ones Nano is offered (at most three) is picked from the question's words and the page,
    without asking the model;
  - "this group" or "this app" is the one on the page, whatever Nano calls it.
- **Keeping Nano on track** (`extension/src/background/localChat.ts`):
  - It looks something up once (twice if that fails), then has to answer.
  - If it writes no answer, which it does when it tries another tool call instead, the lookup's
    summary is the answer.
  - Tool calls it wasn't offered, or got wrong, are left out of the reply.
  - A request to change something starts with a fixed sentence saying the assistant can only read.
- **Context window.** Gemini Nano has about 6,000 tokens. The largest prompt in the evals is about
  830 tokens. Page text is cut to 1,500 characters and history to the last 6 messages.
- **Tool calls are emulated.** Native tool calling in the Prompt API is still behind a flag.
  `@browser-ai/core` describes the tools in the system prompt and parses fenced JSON calls, one per
  step. It's noticeably less reliable than Claude at multi-step lookups.
- **Hardware.** Chrome on Windows, macOS 13+, Linux or ChromeOS (Chromebook Plus), 22 GB free disk,
  and a GPU with more than 4 GB of VRAM (or 16 GB of RAM and 4 cores). The panel says when it can't
  run.
- **First question.** Loading Python and the server takes about 8 s, so the offscreen document
  starts when the chat opens. After that a tool call takes tens of milliseconds plus Okta's response
  time.

## How it works

```
extension/src/
  background/        service worker: Okta sign-in for the assistant, relays chat requests
  chat/              the assistant panel (assistant-ui), page context, resuming after navigation
  console/           the API console drawer: requests, history, endpoint suggestions, JSON tree
                     and table views
  content/
    index.tsx        entry point: mounts the dialog host and starts the scanner
    theme.iife.ts    turns dark mode on and off with the setting
    pageWorld.iife.ts page-world hooks: keeps loads dark until dark mode is ready
    scanner.ts       re-scans on DOM/URL changes; adds/removes view buttons
    dom.ts           finds sections by heading text and rows by object name; detects Edit controls
    viewHost.tsx     shadow DOM + React root (view dialogs, the API console and the chat)
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
doesn't depend on Okta's CSS classes. A **provider** (`extension/src/views/types.ts`) does three things:

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
  dropped whenever `extension/src/theme/` changes (a hash set in `extension/vite.config.ts`) and isn't kept in dev.

### Adding a page

Create `extension/src/views/<area>.ts` that exports a `ViewProvider` (`groupRules.ts` is the smallest
example), add it to
`extension/src/views/index.ts`, and add a unit test under `extension/src/views/__tests__/`.

## Development

```sh
npm run check      # vp check: format + lint (whole workspace)
npm run typecheck
npm test           # unit tests + server integration tests
npm run test:e2e   # builds the extension and runs the browser tests
```

The e2e test (`extension/e2e/smoke.ts`) needs Playwright's Chromium (`npx playwright install chromium`).
Branded Chrome no longer accepts `--load-extension`. The test checks that icons only appear
where Edit is missing, that inputs/selects/checkboxes can't be changed, that the views only send
`GET` requests, and that the API console sends requests (with the XSRF token for `POST`) and keeps
their history. Screenshots are saved to `extension/e2e/*.png`.

- **`server/src/app.test.ts`** runs the real HTTP stack with a fake Okta, a scripted model and a
  stand-in for `okta-mcp-server` (`server/src/testing/`). It covers:
  - only read-only tools are exposed or callable, even when the token has a write scope;
  - one MCP server per org: unknown orgs, and other orgs' tokens, are refused, and an admin of two
    orgs gets a process for each;
  - MCP clients signing in with the MCP SDK's own OAuth client (discovery, registration, consent,
    Okta, code, refresh), and the consent page's checks: cancel, another browser, unregistered
    redirects, and a client registered with one org trying another;
  - one process per admin, each using only its own token;
  - a process being reused and picking up a renewed token;
  - tokens about to expire being refused;
  - a disconnect mid-answer followed by resume;
  - Stop;
  - page context reaching the model;
  - chats being private to their owner.
- **`extension/e2e/chat.ts`** runs the real server in-process with a slow scripted model. It asks a
  question, navigates to another page mid-answer, and checks that the answer resumes and finishes,
  history survives a reload without duplicates, and the page context reached the server.
- **`extension/e2e/onDevice.ts`** runs the on-device assistant, with no server. It uses the real
  `okta-mcp-server` on Pyodide in the offscreen document, against a fake Okta API on the admin
  console, with a scripted stand-in for `LanguageModel` (Playwright's Chromium has no Gemini Nano).
  The only setting it changes is the assistant mode. It checks that the guide's tool runs, the
  call goes from Python through the tab as a GET with the admin's session cookie and no token, the
  answer streams into the panel, and every prompt fits Nano's context window.

**`npm run verify:okta-mcp -w @oktamax/server`** checks the gateway against the **real**
`okta-mcp-server` (it needs `uv`). It starts two admins' processes against a fake HTTPS Okta and
checks four things: each admin's calls carry only their own token, only read tools are exposed, a
write tool call is refused, and only GETs reach Okta. It isn't part of `npm test`, because the
first run downloads Python and the package.

### Testing against a real org

`extension/e2e/okta.ts`, `seed.ts` and `live.ts` drive a real Okta org (an integrator org works).
Put two accounts, a super admin and a read-only admin, both enrolled in Google Authenticator, in
a git-ignored `extension/.env`:

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
cd extension
npx vpx e2e/okta.ts            # check both accounts can sign in (sessions are kept in e2e/.profiles)
npx vpx e2e/seed.ts            # as the super admin, create "Oktamax …" test objects (re-runnable)
npm run build && npx vpx e2e/live.ts   # as the read-only admin, open every view; screenshots in e2e/live/
npm run build && npx vpx e2e/liveOnDevice.ts   # the on-device assistant reads the org (scripted model)
```

The seed only creates new objects, and scopes its policies to a test group or test app. Policy
changes are Okta "protected actions", so the scripts answer the step-up pop-up with the admin's
password and TOTP code.

### Evals for the on-device assistant

`extension/evals/` scores the on-device assistant with the real Gemini Nano, in Google Chrome
rather than Playwright's Chromium, which has no Nano. Okta's MCP server runs on Pyodide as in the
extension, and the org is the live one in `.env`, read as the read-only admin.

```sh
cd extension
npm run build && npm run evals                  # every case
npm run evals -- user-count saml-apps           # some of them
```

- **Chrome:** the runner starts Chrome with its own data folder, `~/.cache/oktamax-evals/chrome`
  (or set `EVAL_CHROME_PROFILE`). Chrome won't allow remote debugging on its default folder, and
  branded Chrome ignores `--load-extension`, so the extension is loaded over the DevTools protocol
  (`Extensions.loadUnpacked`).
- **The model:** the first run clicks Download on the extension's model page, which takes a few
  minutes. The model stays in that folder for later runs, as does the Okta session.
- **Cases:** `evals/cases.ts` gives each question the page it's asked on, the tools a good answer
  uses, and the facts its answer must contain. The facts are read from the org when the eval runs,
  so they stay right as the org changes.
- **Measured:**
  - which tools were called, with what input, and whether they failed;
  - whether the answer contains the facts;
  - total time, and the time and context size of each Prompt API call (timed in the service
    worker).

  A table goes to the terminal and the details, including each answer, to
  `evals/results/<time>.json`.
  With `TIMINGS=1`, it also prints the MCP connection, each Okta call, and each Prompt API session
  and prompt.

- **Results** on the integrator org (12 cases): giving Nano okta-mcp-server's tools directly passed
  2; with the guide, 10–11 pass from run to run, and the largest prompt fell from about 5,300
  tokens to about 830. Answers took a median of 10–56 s, varying between runs. Most of that time
  is Nano starting a session after being idle for 10 s or more, which takes 2–25 s. Neither keeping
  a session open nor cloning one avoided it.

## Known limitations

- The field labels and their order follow Okta's edit dialogs as closely as possible and have been
  checked against a live integrator org (console version 2026.42). Okta changes labels and URL
  paths over time; if one differs (`POLICY_PAGES` in `views/policies/index.ts`, a section
  heading, a label), it's a one-line change in the matching view.
- On policy pages with no policy ID in the URL, the selected policy is worked out from the
  visible heading.
- Authenticator settings and OIN app-specific settings vary per integration, so they are shown
  generically (humanized keys) rather than with Okta's exact labels.
- **The assistant is untested against a live tenant and a real model**; its tests use fakes for both,
  and the Okta scope names your org accepts may need adjusting.
- **`okta-mcp-server` is pinned to 1.1.7.** The gateway depends on two of its internals: it reads
  the token from the keyring on every call, and it picks tools from `OKTA_SCOPES` at startup. Run
  `verify:okta-mcp` before upgrading it. Its SDK (okta 3.4.x) sends `Authorization: Bearer<token>`
  with no space; that's how it behaves for every user of the package, not something the gateway
  introduces.
- **Public-client introspection.** The server identifies itself with only its client ID when it
  introspects tokens. If your org rejects that, give the server a confidential client for
  introspection.
- **Refused answers.** Claude refusals on Bedrock show up as a generic failed response. Bedrock
  has no server-side fallback, and the Vercel AI SDK path doesn't include Anthropic's client-side
  fallback middleware.
