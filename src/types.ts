export interface Env {
  // All set as Cloudflare secrets (`wrangler secret put ...`) or, for local dev,
  // in `.dev.vars`. Nothing here is committed or bundled into the Worker.

  /** Discord bot token. */
  DISCORD_BOT_TOKEN: string;
  /** Default Discord server (guild) ID for the tools. */
  DISCORD_GUILD_ID?: string;
  /**
   * Shared secret that gates access to the MCP endpoint. The connector URL is
   * `https://<host>/mcp/<MCP_SHARED_SECRET>`. Also accepted as
   * `Authorization: Bearer <MCP_SHARED_SECRET>`.
   */
  MCP_SHARED_SECRET: string;
}
