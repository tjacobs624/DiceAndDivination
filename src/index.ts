import { createMcpHandler } from "agents/mcp/server";
import { buildServer } from "./mcp";
import type { Env } from "./types";

const MCP_PREFIX = "/mcp/";

/** Constant-time string compare to avoid leaking the secret via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Public, unauthenticated health check.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("dnd-discord-mcp is running. MCP endpoint: /mcp/<token>\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    const secret = env.MCP_SHARED_SECRET;
    if (!secret) {
      return new Response(
        JSON.stringify({ error: "server_misconfigured", detail: "MCP_SHARED_SECRET is not set" }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }

    // Auth: the secret is the last path segment (/mcp/<token>), or a bearer token.
    let authed = false;
    if (url.pathname.startsWith(MCP_PREFIX)) {
      const token = url.pathname.slice(MCP_PREFIX.length).split("/")[0];
      if (token && safeEqual(token, secret)) authed = true;
    }
    if (!authed) {
      const authz = request.headers.get("authorization");
      if (authz && authz.startsWith("Bearer ") && safeEqual(authz.slice(7), secret)) {
        authed = true;
      }
    }

    if (!authed) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    // Stateless Streamable HTTP MCP handler; a fresh server is built per request.
    const handler = createMcpHandler(() => buildServer(env));
    return handler(request, env, ctx);
  },
};
