export interface Env {
  /** Discord bot token (secret). Set via `wrangler secret put DISCORD_BOT_TOKEN`. */
  DISCORD_BOT_TOKEN: string;
  /** Default Discord server (guild) ID for the tools. */
  DISCORD_GUILD_ID: string;
  /** Cloudflare Access team domain, e.g. https://myteam.cloudflareaccess.com (no trailing slash). */
  ACCESS_TEAM_DOMAIN: string;
  /** Application Audience (AUD) tag of the Access app protecting this Worker. */
  ACCESS_AUD: string;
  /** "true" only for local dev to skip Access JWT verification. */
  DEV_AUTH_BYPASS?: string;
}
