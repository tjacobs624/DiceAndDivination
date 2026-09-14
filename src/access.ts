import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { config } from "./config";

/**
 * Verifies the Cloudflare Access identity JWT that Access injects on every
 * request it forwards to the origin (the `Cf-Access-Jwt-Assertion` header).
 *
 * This is defense-in-depth: even though Access already authenticated the user
 * at the edge, we independently verify the token so that any request that did
 * NOT come through Access (e.g. someone hitting the origin directly) is denied.
 *
 * Verification checks:
 *  - signature against the team's JWKS (`/cdn-cgi/access/certs`)
 *  - issuer == the Access team domain
 *  - audience includes this application's AUD tag
 */

type VerifyResult = { ok: true; email?: string; sub?: string } | { ok: false; error: string };

// Cache the JWKS getter per team domain across requests (module scope persists
// within a Worker isolate).
let cachedTeam: string | undefined;
let cachedJwks: JWTVerifyGetKey | undefined;

function jwksFor(team: string): JWTVerifyGetKey {
  if (cachedJwks && cachedTeam === team) return cachedJwks;
  cachedTeam = team;
  cachedJwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
  return cachedJwks;
}

export async function verifyAccessJwt(request: Request): Promise<VerifyResult> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return {
      ok: false,
      error:
        "Missing Cf-Access-Jwt-Assertion header. This request did not pass through " +
        "Cloudflare Access. Connect via the Access-protected hostname.",
    };
  }

  const team = config.accessTeamDomain?.replace(/\/+$/, "");
  if (!team || !config.accessAud || config.accessAud.startsWith("YOUR_")) {
    return {
      ok: false,
      error:
        "Server is missing accessTeamDomain / accessAud in config.json. " +
        "Copy config.sample.json to config.json and fill it in before going live.",
    };
  }

  try {
    const { payload } = await jwtVerify(token, jwksFor(team), {
      issuer: team,
      audience: config.accessAud,
    });
    return {
      ok: true,
      email: typeof payload.email === "string" ? payload.email : undefined,
      sub: payload.sub,
    };
  } catch (e) {
    return { ok: false, error: `Invalid Access JWT: ${e instanceof Error ? e.message : String(e)}` };
  }
}
