# Dice & Divination — Discord MCP for Claude

A remote **MCP server** on **Cloudflare Workers** that lets **Claude (Cowork / claude.ai)** read your
**D&D Discord server** — messages, history, pins, search, members — as context to help you build
characters and run your game.

Authentication follows Cloudflare's documented
[**Secure MCP servers**](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)
pattern: the Worker runs its **own OAuth server** (`@cloudflare/workers-oauth-provider`, which the
claude.ai connector registers against) and authenticates users **upstream via an "Access for SaaS"
application** in Cloudflare Access — so you sign in with **Discord**, gated by your Access policy.

```
Claude ──OAuth (DCR)──► this Worker's OAuth server ──OIDC──► Access for SaaS ──► Discord login
                                    │ issues Claude a token
                                    ▼
                        MCP tools ──Bot token──► Discord REST API ──► your D&D server
```

## Tools

| Tool | What it does |
|------|--------------|
| `list_channels` | List text channels/threads + IDs |
| `get_channel_history` | Read recent messages (chronological) |
| `search_messages` | Search a channel by text and/or author |
| `get_pinned_messages` | Read a channel's pins |
| `get_channel_info` | Metadata for one channel |
| `get_server_info` | Server name + member counts |
| `list_members` | Members list *(needs Server Members Intent)* |

Channels accept an ID or `#name`; all default to the configured server.

---

## Setup

### 1. Discord bot
- [Developer Portal](https://discord.com/developers/applications) → your app → **Bot** → copy the token.
- Enable **Message Content Intent** (and **Server Members Intent** for `list_members`).
- Invite with **View Channels + Read Message History**:
  `https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=66560`

### 2. Create an "Access for SaaS" application (this is the Cloudflare Access part)
Zero Trust → **Access controls → Applications → Add an application → SaaS**:
- **Application:** a name (e.g. `DnD MCP`), then select **OIDC** as the protocol → **Add application**.
- **Redirect URLs:** `https://dnd-mcp.charmandcrit.com/callback`
- Copy these five values (used as Worker secrets below): **Client ID, Client secret, Authorization
  endpoint, Token endpoint, Key endpoint**.
- (Optional) Advanced settings → enable **Refresh tokens**.
- Add an **Access policy** (Allow) identifying you — and set **Discord** as the identity provider so
  login is "sign in with Discord."

### 3. Deploy
This repo auto-deploys via **Workers Builds** on push to `main` (the `OAUTH_KV` namespace and the
`MyMCP` Durable Object are already declared in `wrangler.jsonc`). Or run `npm install && npm run deploy`.

### 4. Set the Worker secrets
Workers & Pages → `dnd-discord-mcp` → Settings → **Variables and Secrets** (Type = Secret):

| Secret | Value |
|---|---|
| `ACCESS_CLIENT_ID` | SaaS app → Client ID |
| `ACCESS_CLIENT_SECRET` | SaaS app → Client secret |
| `ACCESS_AUTHORIZATION_URL` | SaaS app → Authorization endpoint |
| `ACCESS_TOKEN_URL` | SaaS app → Token endpoint |
| `ACCESS_JWKS_URL` | SaaS app → Key endpoint |
| `COOKIE_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_GUILD_ID` | `1472702824109314058` |
| `ALLOWED_EMAILS` *(optional)* | comma-separated emails allowed to use the tools |

### 5. Connect in Claude
Claude → Settings → Connectors → **Add custom connector** → `https://dnd-mcp.charmandcrit.com/mcp`
→ **Connect**. You'll be sent to Cloudflare Access → **sign in with Discord** → approve → done.

---

## How it differs from a "put Access in front" setup
Cloudflare Access is **not** placed in front of this hostname. The Worker itself is the OAuth
authorization server the MCP client talks to (so dynamic client registration works with the
claude.ai web connector), and it delegates the actual login to Access for SaaS. This is the
topology Cloudflare documents for custom MCP servers.

## Project layout
```
src/
  index.ts               OAuthProvider wiring + McpAgent with the Discord tools
  access-handler.ts      Upstream OAuth to Access for SaaS (authorize/callback, PKCE, JWT verify)
  workers-oauth-utils.ts OAuth/CSRF/PKCE/approval-dialog helpers
  discord.ts             Read-only Discord REST client
wrangler.jsonc           Worker config: DO migration, OAUTH_KV, custom domain route
```

Based on Cloudflare's `remote-mcp-cf-access` reference template.

## Local development
```bash
cp .dev.vars.example .dev.vars   # fill in the secrets
npm install
npm run dev
```

---

## Deploying (Workers Builds)

Pushes to `main` are built and deployed by **Cloudflare Workers Builds**.

- **Secrets are bound at deploy time.** After adding or changing a secret in the
  dashboard, a new deploy must run for the live version to pick it up. If a
  request errors with a missing binding (e.g. `cookieSecret is required for
  signing cookies`), the running version predates the secret — redeploy.
- **Confirm the latest version is actually serving.** Workers & Pages →
  `dnd-discord-mcp` → **Deployments**: the newest version should be the active
  one. If new versions are being uploaded but not promoted, set the build's
  **Deploy command** to `npx wrangler deploy`.
- `GET /debug/env` reports which secrets are bound in the live version
  (booleans only, no values) — remove it once auth is confirmed working.
