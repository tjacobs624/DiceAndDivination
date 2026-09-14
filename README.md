# Dice & Divination — Discord MCP for Claude

A remote **MCP (Model Context Protocol) server** running on **Cloudflare Workers** that lets
**Claude (Cowork / claude.ai)** read your **D&D Discord channel** — messages, history, pinned
notes, members — and use it as context to help you build characters and run your game.

You work in Claude as normal; this server just gives Claude read‑only "eyes" into your Discord.

```
  You in Claude (Cowork on the web)
          │  "read the last session in #campaign and summarize where we left off"
          ▼
  Claude custom connector  ──OAuth──►  Cloudflare Access  ──"Sign in with Discord"──►  you
          │  (Access injects a verified identity JWT)
          ▼
  This Worker (dnd-discord-mcp)  ──Bot token──►  Discord REST API  ──►  your D&D server
```

**Why this shape?**
- Reading Discord messages uses plain HTTPS REST calls — no always‑on gateway/websocket — which
  is exactly what Workers do well (and cheaply).
- **Cloudflare Access** provides real OAuth so only *you* (signed in with Discord) can reach the
  server. You already run a `discord-oidc` worker, so Access can log you in with Discord.
- The bot is **read‑only** and only sees channels you invite it to.

---

## What Claude can do once connected

| Tool | What it does |
|------|--------------|
| `list_channels` | List text channels/threads and their IDs |
| `get_channel_history` | Read recent messages (chronological) from a channel — catch up on a session |
| `search_messages` | Search a channel's history for a term and/or author — find lore, NPCs, rulings |
| `get_pinned_messages` | Read a channel's pins — house rules, character sheets, party inventory |
| `get_channel_info` | Metadata for one channel |
| `get_server_info` | Server name + member counts |
| `list_members` | Players/members list *(needs Server Members Intent — see below)* |

All tools accept a channel **ID** or a **`#channel-name`**, and default to your configured server.

---

## Prerequisites

- A **Cloudflare account** with **Zero Trust / Access** enabled (team domain
  `myjacobsnetwork.cloudflareaccess.com`).
- A **domain in that Cloudflare account** (a zone in Cloudflare DNS) — Access can protect a custom
  hostname but **not** a `*.workers.dev` URL.
- Your **Discord application** (Developer Portal) with a **Bot**.
- Node.js 18+ and `npm` locally.

---

## Step 1 — Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot**.
2. **Reset Token** and copy the **bot token** (you'll store it as a Worker secret in Step 3).
3. Under **Privileged Gateway Intents**, enable **Message Content Intent** *(required so the bot can
   read message text over the REST API)*. Enable **Server Members Intent** too if you want
   `list_members`.
4. Invite the bot to your D&D server with **read‑only** permissions. Use an OAuth2 URL with scope
   `bot` and permissions **View Channels** + **Read Message History** (and **View Server Insights**
   is not needed). Example:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=66560
   ```
   `66560` = View Channels (1024) + Read Message History (65536).
5. Get your **server (guild) ID**: in Discord, enable Developer Mode (Settings → Advanced), then
   right‑click your server → **Copy Server ID**.

---

## Step 2 — Configure the project

Config is split the same way as `discord-oidc`: **secrets and deploy config never get committed.**

1. **`config.json`** (gitignored — real values live here only). Copy the sample and fill it in:
   ```bash
   cp config.sample.json config.json
   ```
   ```jsonc
   {
     "guildId": "your D&D server ID (Step 1.5)",
     "accessTeamDomain": "https://myjacobsnetwork.cloudflareaccess.com",
     "accessAud": "fill in after Step 4 (the Access application AUD tag)"
   }
   ```
   Leave `accessAud` as the placeholder for now; you set it in **Step 4** and redeploy.

2. **`wrangler.toml`** (committed — no secrets here). Set `routes[0].pattern` to the custom
   hostname you'll serve on, e.g. `dnd-mcp.charmandcrit.com` (a subdomain on a zone in your Cloudflare
   account). The hostname isn't secret, so it's fine to commit.

3. The **bot token** is a Cloudflare secret, set in Step 3 — never in a file.

---

## Step 3 — Deploy the Worker

```bash
npm install
npx wrangler login            # authorize wrangler to your Cloudflare account
npx wrangler secret put DISCORD_BOT_TOKEN   # paste the bot token when prompted
npm run deploy
```

The `[[routes]]` entry with `custom_domain = true` tells Cloudflare to create the custom hostname
and route it to this Worker (the zone must already exist in your account). After deploy, visiting
`https://dnd-mcp.charmandcrit.com/` should return a small "is running" message.

> The `/mcp` endpoint itself will return **401 unauthorized** until you put Access in front of it —
> that's expected and correct.

---

## Step 4 — Put Cloudflare Access (Managed OAuth) in front of `/mcp`

This makes Access the **OAuth authorization server** for the MCP connection: Claude does a standard
OAuth flow against Access, Access logs you in with Discord, and forwards a verified identity JWT to
the Worker.

In the **Zero Trust dashboard** (one.dash.cloudflare.com):

1. **Access → Applications → Add an application → Self‑hosted.**
   - **Application domain:** `dnd-mcp.charmandcrit.com` (the same hostname as Step 2).
   - Save. Open the application and copy its **Application Audience (AUD) Tag** — a long hex string.
   - Add a **policy**: Action **Allow**, and a rule that identifies *you* — e.g. Emails =
     your email, or (using your `discord-oidc` login method) your Discord identity / a specific
     Discord server membership.
2. **Access → AI controls → MCP servers → Add an MCP server.**
   - **Name:** `Dice & Divination`
   - **HTTP URL:** `https://dnd-mcp.charmandcrit.com/mcp`  ← include the `/mcp` path.
   - Attach the same Access policy (only you).
   - **Advanced settings → enable *Managed OAuth*.**
3. Put the **AUD tag** from step 1 into `config.json` → `accessAud`, then redeploy:
   ```bash
   npm run deploy
   ```
   (The Worker verifies that AUD on every request, so it must match.)

> The Worker independently verifies the `Cf-Access-Jwt-Assertion` JWT (signature via your team's
> JWKS, issuer, and audience). Even if someone found the origin, requests without a valid Access
> token are rejected.

---

## Step 5 — Add it to Claude

1. In Claude (claude.ai → **Settings → Connectors**, or the Cowork connector UI) → **Add custom
   connector**.
2. Paste the MCP URL: `https://dnd-mcp.charmandcrit.com/mcp`.
3. Click **Connect**. Claude discovers Access's OAuth, redirects you to
   `myjacobsnetwork.cloudflareaccess.com`, you **sign in with Discord**, and you're linked.
4. In a Cowork session / chat, enable the connector and its tools. Try:
   - *"List the channels in my D&D server."*
   - *"Read the last 50 messages in #campaign and summarize where we left off."*
   - *"Search #lore for 'the Obsidian Crown' and tell me what we know."*
   - *"Based on the party chatter in #general, suggest a level‑3 character that fits the group."*

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # put your bot token in it; keep DEV_AUTH_BYPASS="true"
npm run dev
```

`DEV_AUTH_BYPASS="true"` skips the Access JWT check locally (there's no Access proxy in front of a
dev server). **Never** set it to `true` in production. Test the endpoint with an MCP client pointed
at `http://localhost:8787/mcp`.

---

## Security notes

- The Discord bot is **read‑only** and limited by Discord's own permissions to the channels you
  invite it to.
- The bot token lives only as an encrypted **Worker secret**, never in the repo.
- Access enforces **who** can connect (only your identity/policy). The Worker double‑checks the
  Access JWT (`aud` + `iss` + signature) as defense‑in‑depth.
- `workers_dev` is disabled so there's no unprotected `*.workers.dev` back door.

## Troubleshooting

- **401 from `/mcp` in a browser** — expected; that path requires an Access token.
- **`Missing Cf-Access-Jwt-Assertion`** — the request didn't go through Access. Make sure you're
  using the Access‑protected custom hostname and that the MCP server/app is configured in Step 4.
- **`Invalid Access JWT: ... audience`** — `accessAud` in `config.json` doesn't match the Access
  application's AUD tag. Copy it again and redeploy.
- **Discord `401/403`** — bot token wrong, or the bot isn't in the server / lacks View Channel +
  Read Message History.
- **Empty message `content`** — enable **Message Content Intent** in the Developer Portal.
- **`list_members` errors** — enable **Server Members Intent**.

---

## Project layout

```
src/
  index.ts    Worker entry: routing, Access JWT gate, MCP handler
  access.ts   Cloudflare Access JWT verification (jose + JWKS)
  discord.ts  Read-only Discord REST client
  mcp.ts      MCP server + tool definitions
  config.ts   Loads config.json (guild, Access team domain + AUD)
  types.ts    Env bindings (bot token secret)
config.sample.json  Template — copy to config.json (gitignored) and fill in
wrangler.toml       Worker config (routes; no secrets)
```

Built with the Cloudflare [`agents`](https://www.npmjs.com/package/agents) `createMcpHandler`
(stateless Streamable HTTP) and the [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
SDK.
