export interface Env {
  /** Discord bot token (secret). Set via `wrangler secret put DISCORD_BOT_TOKEN`. */
  DISCORD_BOT_TOKEN: string;
  /** "true" only for local dev to skip Access JWT verification. */
  DEV_AUTH_BYPASS?: string;
}
