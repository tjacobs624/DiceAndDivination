import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { handleAccessRequest } from "./access-handler";
import type { Props } from "./workers-oauth-utils";
import {
  cleanChannel,
  cleanMessage,
  getChannel,
  getGuild,
  getMessages,
  getPins,
  listChannels,
  listMembers,
  resolveChannelId,
  searchMessages,
} from "./discord";

function text(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errText(e: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  };
}

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer({
    name: "dnd-discord",
    version: "0.1.0",
  });

  /** Resolve the guild to use: explicit arg wins, otherwise the configured default. */
  private guildOf(arg?: string): string {
    const g = (arg && arg.trim()) || this.env.DISCORD_GUILD_ID;
    if (!g) {
      throw new Error("No guild ID available. Pass guild_id, or set the DISCORD_GUILD_ID secret.");
    }
    return g;
  }

  async init() {
    // If ALLOWED_EMAILS is set (comma-separated), restrict tools to those users.
    // Otherwise any user who passed the Cloudflare Access policy may use the tools.
    const allowList = (this.env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const email = (this.props?.email ?? "").toLowerCase();
    if (allowList.length > 0 && !allowList.includes(email)) {
      // No tools registered for users outside the allow list.
      return;
    }

    this.server.tool(
      "list_channels",
      "List the text channels/threads in the D&D Discord server, with their IDs. Use this first to discover channel names/IDs.",
      { guild_id: z.string().optional().describe("Guild ID. Defaults to the configured D&D server.") },
      async ({ guild_id }) => {
        try {
          const channels = await listChannels(this.env, this.guildOf(guild_id));
          return text(channels.map(cleanChannel));
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "get_channel_history",
      "Read recent messages from a channel in chronological order (oldest first). Accepts a channel ID or #name.",
      {
        channel: z.string().describe("Channel ID or #name to read from."),
        limit: z.number().int().min(1).max(100).optional().describe("How many messages (1-100, default 50)."),
        before: z.string().optional().describe("Only messages before this message ID (paging back)."),
        after: z.string().optional().describe("Only messages after this message ID."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution."),
      },
      async ({ channel, limit, before, after, guild_id }) => {
        try {
          const channelId = await resolveChannelId(this.env, this.guildOf(guild_id), channel);
          const messages = await getMessages(this.env, channelId, { limit, before, after });
          return text({ channel_id: channelId, count: messages.length, messages: messages.map(cleanMessage) });
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "search_messages",
      "Search a channel's recent history for messages containing a text query and/or from a specific author. Returns the newest matches.",
      {
        channel: z.string().describe("Channel ID or #name to search."),
        query: z.string().optional().describe("Case-insensitive text to match in message content."),
        author_id: z.string().optional().describe("Only messages from this Discord user ID."),
        limit: z.number().int().min(1).max(100).optional().describe("Max matches (default 25)."),
        max_scan: z.number().int().min(1).max(1000).optional().describe("Messages to scan (default 300, max 1000)."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution."),
      },
      async ({ channel, query, author_id, limit, max_scan, guild_id }) => {
        try {
          const channelId = await resolveChannelId(this.env, this.guildOf(guild_id), channel);
          const matches = await searchMessages(this.env, channelId, {
            query,
            authorId: author_id,
            limit,
            maxScan: max_scan,
          });
          return text({ channel_id: channelId, count: matches.length, matches });
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "get_pinned_messages",
      "Get the pinned messages of a channel (house rules, character sheets, party inventory, session notes).",
      {
        channel: z.string().describe("Channel ID or #name."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution."),
      },
      async ({ channel, guild_id }) => {
        try {
          const channelId = await resolveChannelId(this.env, this.guildOf(guild_id), channel);
          const pins = await getPins(this.env, channelId);
          return text({ channel_id: channelId, count: pins.length, pinned: pins.map(cleanMessage) });
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "get_channel_info",
      "Get metadata for a single channel (name, topic, type, parent category).",
      {
        channel: z.string().describe("Channel ID or #name."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution."),
      },
      async ({ channel, guild_id }) => {
        try {
          const channelId = await resolveChannelId(this.env, this.guildOf(guild_id), channel);
          return text(cleanChannel(await getChannel(this.env, channelId)));
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "get_server_info",
      "Get high-level info about the D&D Discord server (name, member counts, etc.).",
      { guild_id: z.string().optional().describe("Guild ID. Defaults to the configured D&D server.") },
      async ({ guild_id }) => {
        try {
          return text(await getGuild(this.env, this.guildOf(guild_id)));
        } catch (e) {
          return errText(e);
        }
      },
    );

    this.server.tool(
      "list_members",
      "List members of the D&D server (username, nickname, roles). Requires the bot's Server Members Intent to be enabled in the Discord Developer Portal.",
      {
        limit: z.number().int().min(1).max(1000).optional().describe("Max members (default 100)."),
        guild_id: z.string().optional().describe("Guild ID. Defaults to the configured D&D server."),
      },
      async ({ limit, guild_id }) => {
        try {
          const members = await listMembers(this.env, this.guildOf(guild_id), limit ?? 100);
          return text(
            members.map((m) => ({
              id: m.user?.id,
              username: m.user?.username,
              display_name: m.nick || m.user?.global_name || m.user?.username,
              is_bot: Boolean(m.user?.bot),
              roles: m.roles ?? [],
              joined_at: m.joined_at,
            })),
          );
        } catch (e) {
          return errText(e);
        }
      },
    );
  }
}

export default new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp") as any,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: { fetch: handleAccessRequest as any },
  tokenEndpoint: "/token",
});
