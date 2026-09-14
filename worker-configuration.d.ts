// Runtime bindings for the Worker. Cloudflare runtime types (KVNamespace,
// DurableObjectNamespace, etc.) come from @cloudflare/workers-types.
import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    // Durable Object that backs the MCP agent sessions.
    MCP_OBJECT: DurableObjectNamespace;
    // KV used by @cloudflare/workers-oauth-provider for tokens/grants/state.
    OAUTH_KV: KVNamespace;
    // Injected by the OAuth provider library.
    OAUTH_PROVIDER: OAuthHelpers;

    // Upstream Access for SaaS (OIDC) OAuth client credentials + endpoints.
    ACCESS_CLIENT_ID: string;
    ACCESS_CLIENT_SECRET: string;
    ACCESS_TOKEN_URL: string;
    ACCESS_AUTHORIZATION_URL: string;
    ACCESS_JWKS_URL: string;
    // Random 32-byte hex used to sign approval/CSRF cookies.
    COOKIE_ENCRYPTION_KEY: string;

    // Discord.
    DISCORD_BOT_TOKEN: string;
    DISCORD_GUILD_ID?: string;

    // Optional comma-separated allow list of emails permitted to use the tools.
    ALLOWED_EMAILS?: string;
  }
}

export {};
