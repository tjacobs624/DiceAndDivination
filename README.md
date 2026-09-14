# Dice & Divination — Discord MCP for Claude

A remote **MCP (Model Context Protocol) server** on **Cloudflare Workers** that lets
**Claude (Cowork / claude.ai)** read your **D&D Discord channel** — messages, history, pinned
notes, members — and use it as context to help you build characters and run your game.

You work in Claude as normal; this server gives Claude read‑only "eyes" into your Discord.

```
You in Claude ──(secret URL)──► This Worker ──Bot token──► Discord REST API ──► your D&D server
```

## Auth model (simple + reliable)

The MCP endpoint is protected by a **long random secret in the URL**:

```
https://dnd-mcp.charmandcrit.com/mcp/<MCP_SHARED_SECRET>
```

- Only someone who knows the full URL can reach it. Treat that URL like a password.
- The Worker also accepts `Authorization: Bearer <MCP_SHARED_SECRET>`.
- No OAuth handshake, so it connects cleanly from the claude.ai web/Cowork connector.
- The Discord bot is **read‑only** and only sees channels you invite it to; its token lives only
  as an encrypted Worker secret.

> Why not Cloudflare Access OAuth? The claude.ai *web* connector currently fails dynamic client
> registration against Cloudflare Access Managed OAuth
> ([tracking issue](https://github.com/anthropics/claude-ai-mcp/issues/410)). The secret‑URL
> approach avoids that entirely. You can layer OAuth back on later if you want.

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

## Setup

### 1. Discord bot
1. [Discord Developer Portal](https://discord.com/developers/applications) → your app → **Bot** →
   copy the **bot token**.
2. **Privileged Gateway Intents:** enable **Message Content Intent** (required to read message
   text). Enable **Server Members Intent** too if you want `list_members`.
3. Invite the bot to your server with **View Channels** + **Read Message History**:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot&permissions=66560
   ```
4. Server (guild) ID: Discord → Developer Mode on → right‑click server → **Copy Server ID**.

### 2. Deploy the Worker
This repo auto‑deploys via Cloudflare **Workers Builds** on every push to `main` (Workers & Pages →
your `dnd-discord-mcp` Worker → Settings → Builds, connected to this GitHub repo). Set the custom
hostname in `wrangler.toml` (`routes[0].pattern`, already `dnd-mcp.charmandcrit.com`).

> ⚠️ This Worker must **not** be behind Cloudflare Access. If you previously created an Access
> application for `dnd-mcp.charmandcrit.com`, delete it (Zero Trust → Access controls →
> Applications → your app → **Delete**), otherwise Access intercepts requests before the secret
> URL is checked.

### 3. Set the secrets
In **Workers & Pages → `dnd-discord-mcp` → Settings → Variables and Secrets → Add** (Type =
**Secret** each), then **Deploy**:

| Variable name | Value |
|---|---|
| `DISCORD_BOT_TOKEN` | your Discord bot token |
| `DISCORD_GUILD_ID` | your D&D server ID |
| `MCP_SHARED_SECRET` | a long random string — generate with `openssl rand -hex 32` |

### 4. Add it to Claude
1. Claude → **Settings → Connectors → Add custom connector**.
2. URL: `https://dnd-mcp.charmandcrit.com/mcp/<MCP_SHARED_SECRET>` (the same secret you set above).
3. Save. No OAuth prompt — it connects directly.
4. In a chat / Cowork session, enable the connector and try:
   - *"List the channels in my D&D server."*
   - *"Read the last 30 messages in [your session channel] and summarize where we left off."*
   - *"Based on the party chatter, suggest a level‑3 character that fits the group."*

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the three values
npm install
npm run dev
```

Test at `http://localhost:8787/mcp/<MCP_SHARED_SECRET>`.

---

## Troubleshooting
- **401 unauthorized** — the secret in the URL doesn't match `MCP_SHARED_SECRET`, or you hit `/mcp`
  without the token segment.
- **Discord `401/403`** — bot token wrong, or the bot isn't in the server / lacks View Channel +
  Read Message History.
- **Empty message `content`** — enable **Message Content Intent** in the Developer Portal.
- **`list_members` errors** — enable **Server Members Intent**.
- **Claude connector tries to do OAuth / asks to sign in** — the hostname is still behind Cloudflare
  Access. Delete that Access application (see step 2).

---

## Project layout
```
src/
  index.ts    Worker entry: routing, secret-URL gate, MCP handler
  discord.ts  Read-only Discord REST client
  mcp.ts      MCP server + tool definitions
  types.ts    Env bindings (all runtime secrets)
.dev.vars.example   Template for local `.dev.vars` (gitignored)
wrangler.toml       Worker config (route only; no secrets)
```

Built with the Cloudflare [`agents`](https://www.npmjs.com/package/agents) `createMcpHandler`
(stateless Streamable HTTP) and the
[`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server) SDK.
