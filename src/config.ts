// Deploy configuration. The real values live in `config.json` at the project
// root, which is GITIGNORED — copy `config.sample.json` to `config.json` and
// fill it in. Nothing here is committed with real values.
//
// The Discord bot token is deliberately NOT here: it is a Cloudflare secret
// (`wrangler secret put DISCORD_BOT_TOKEN`) read from the Worker env at runtime.
import configJson from "../config.json";

export interface AppConfig {
  /** Default Discord server (guild) ID for the tools. */
  guildId: string;
  /** Cloudflare Access team domain, e.g. https://myteam.cloudflareaccess.com (no trailing slash). */
  accessTeamDomain: string;
  /** Application Audience (AUD) tag of the Access app protecting this Worker. */
  accessAud: string;
}

export const config = configJson as AppConfig;
