import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Env } from "./types";
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

/** Resolve the guild to use: explicit arg wins, otherwise the configured default. */
function guildOf(env: Env, arg?: string): string {
  const g = (arg && arg.trim()) || env.DISCORD_GUILD_ID;
  if (!g || g.startsWith("CHANGE-ME")) {
    throw new Error(
      "No guild ID available. Pass guild_id, or set DISCORD_GUILD_ID in the Worker config."
    );
  }
  return g;
}

export function buildServer(env: Env): McpServer {
  const server = new McpServer({ name: "dnd-discord", version: "0.1.0" });

  server.registerTool(
    "list_channels",
    {
      title: "List Discord channels",
      description:
        "List the text channels (and threads/forums) in the D&D Discord server, with their IDs. " +
        "Use this first to discover channel names/IDs for the other tools.",
      inputSchema: {
        guild_id: z
          .string()
          .optional()
          .describe("Discord server (guild) ID. Defaults to the configured D&D server."),
      },
    },
    async ({ guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const channels = await listChannels(env, guild);
        return text(channels.map(cleanChannel));
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "get_channel_history",
    {
      title: "Read channel messages",
      description:
        "Read recent messages from a channel in chronological order (oldest first). " +
        "Great for catching up on what happened in a session or thread. " +
        "Accepts a channel ID or a #channel-name.",
      inputSchema: {
        channel: z.string().describe("Channel ID or #name to read from."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("How many messages to fetch (1-100, default 50)."),
        before: z.string().optional().describe("Only messages before this message ID (for paging back)."),
        after: z.string().optional().describe("Only messages after this message ID."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution. Defaults to configured server."),
      },
    },
    async ({ channel, limit, before, after, guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const channelId = await resolveChannelId(env, guild, channel);
        const messages = await getMessages(env, channelId, { limit, before, after });
        return text({ channel_id: channelId, count: messages.length, messages: messages.map(cleanMessage) });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "search_messages",
    {
      title: "Search channel messages",
      description:
        "Search a channel's recent history for messages containing a text query and/or from a " +
        "specific author. Scans back through history (bounded) and returns the newest matches. " +
        "Useful for finding lore, a character's mentions, past rulings, or NPC notes.",
      inputSchema: {
        channel: z.string().describe("Channel ID or #name to search."),
        query: z.string().optional().describe("Case-insensitive text to match in message content."),
        author_id: z.string().optional().describe("Only messages from this Discord user ID."),
        limit: z.number().int().min(1).max(100).optional().describe("Max matches to return (default 25)."),
        max_scan: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe("How many recent messages to scan through (default 300, max 1000)."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution. Defaults to configured server."),
      },
    },
    async ({ channel, query, author_id, limit, max_scan, guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const channelId = await resolveChannelId(env, guild, channel);
        const matches = await searchMessages(env, channelId, {
          query,
          authorId: author_id,
          limit,
          maxScan: max_scan,
        });
        return text({ channel_id: channelId, count: matches.length, matches });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "get_pinned_messages",
    {
      title: "Get pinned messages",
      description:
        "Get the pinned messages of a channel. Pins usually hold the important stuff: house rules, " +
        "character sheets, party inventory, session zero notes, links.",
      inputSchema: {
        channel: z.string().describe("Channel ID or #name."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution. Defaults to configured server."),
      },
    },
    async ({ channel, guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const channelId = await resolveChannelId(env, guild, channel);
        const pins = await getPins(env, channelId);
        return text({ channel_id: channelId, count: pins.length, pinned: pins.map(cleanMessage) });
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "get_channel_info",
    {
      title: "Get channel info",
      description: "Get metadata for a single channel (name, topic, type, parent category).",
      inputSchema: {
        channel: z.string().describe("Channel ID or #name."),
        guild_id: z.string().optional().describe("Guild ID for #name resolution. Defaults to configured server."),
      },
    },
    async ({ channel, guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const channelId = await resolveChannelId(env, guild, channel);
        const info = await getChannel(env, channelId);
        return text(cleanChannel(info));
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "get_server_info",
    {
      title: "Get server info",
      description: "Get high-level info about the D&D Discord server (name, member counts, etc.).",
      inputSchema: {
        guild_id: z.string().optional().describe("Guild ID. Defaults to the configured D&D server."),
      },
    },
    async ({ guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        return text(await getGuild(env, guild));
      } catch (e) {
        return errText(e);
      }
    }
  );

  server.registerTool(
    "list_members",
    {
      title: "List server members",
      description:
        "List members of the D&D server (username, nickname, roles). Handy for knowing who the " +
        "players are. NOTE: requires the bot's 'Server Members Intent' to be enabled in the " +
        "Discord Developer Portal, otherwise Discord returns an error.",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional().describe("Max members to return (default 100)."),
        guild_id: z.string().optional().describe("Guild ID. Defaults to the configured D&D server."),
      },
    },
    async ({ limit, guild_id }) => {
      try {
        const guild = guildOf(env, guild_id);
        const members = await listMembers(env, guild, limit ?? 100);
        return text(
          members.map((m) => ({
            id: m.user?.id,
            username: m.user?.username,
            display_name: m.nick || m.user?.global_name || m.user?.username,
            is_bot: Boolean(m.user?.bot),
            roles: m.roles ?? [],
            joined_at: m.joined_at,
          }))
        );
      } catch (e) {
        return errText(e);
      }
    }
  );

  return server;
}
