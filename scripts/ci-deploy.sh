#!/usr/bin/env sh
# Deploy for Cloudflare Workers Builds.
#
# Workers Builds wipes dashboard-set runtime secrets on every git deploy
# (cloudflare/workers-sdk#8871). To work around that, we re-apply the secrets
# on every deploy using `wrangler deploy --secrets-file`, which is additive
# (omitted secrets are preserved, listed ones are (re)set).
#
# The secret VALUES come from Workers Builds "Build variables and secrets"
# (Settings > Build), which are injected as env vars during the build. Add each
# of the names below there (as encrypted secrets), and set this repo's
# `npm run deploy:ci` as the Workers Builds Deploy command.
set -e

node -e '
const names = [
  "COOKIE_ENCRYPTION_KEY",
  "ACCESS_CLIENT_ID",
  "ACCESS_CLIENT_SECRET",
  "ACCESS_AUTHORIZATION_URL",
  "ACCESS_TOKEN_URL",
  "ACCESS_JWKS_URL",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "ALLOWED_EMAILS",
];
const out = {};
for (const n of names) {
  const v = process.env[n];
  if (v !== undefined && v !== "") out[n] = v;
}
require("fs").writeFileSync(".ci-secrets.json", JSON.stringify(out));
console.log("Applying " + Object.keys(out).length + " secret(s) with this deploy.");
'

npx wrangler deploy --secrets-file .ci-secrets.json
rm -f .ci-secrets.json
