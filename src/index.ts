import { createMcpHandler } from "agents/mcp/server";
import { verifyAccessJwt } from "./access";
import { buildServer } from "./mcp";
import type { Env } from "./types";

const MCP_PATH = "/mcp";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Public, unauthenticated health check.
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(
        "dnd-discord-mcp is running. MCP (Streamable HTTP) endpoint: " + MCP_PATH + "\n",
        { status: 200, headers: { "content-type": "text/plain" } }
      );
    }

    if (url.pathname !== MCP_PATH) {
      return new Response("Not found. MCP endpoint is at " + MCP_PATH, { status: 404 });
    }

    // Enforce Cloudflare Access identity (skip only for local dev bypass).
    if (env.DEV_AUTH_BYPASS !== "true") {
      const auth = await verifyAccessJwt(request);
      if (!auth.ok) {
        return new Response(JSON.stringify({ error: "unauthorized", detail: auth.error }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // Stateless Streamable HTTP MCP handler; a fresh server is built per request.
    const handler = createMcpHandler(() => buildServer(env));
    return handler(request, env, ctx);
  },
};
