import type { Env } from "./types";

const API = "https://discord.com/api/v10";

// Channel type constants we care about (Discord API v10).
// https://discord.com/developers/docs/resources/channel#channel-object-channel-types
const TEXTLIKE_CHANNEL_TYPES = new Set([
  0, // GUILD_TEXT
  5, // GUILD_ANNOUNCEMENT
  10, // ANNOUNCEMENT_THREAD
  11, // PUBLIC_THREAD
  12, // PRIVATE_THREAD
  15, // GUILD_FORUM
]);

export interface RawMessage {
  id: string;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  author?: { id: string; username: string; global_name?: string | null; bot?: boolean };
  attachments?: Array<{ filename: string; url: string; content_type?: string }>;
  embeds?: unknown[];
  pinned?: boolean;
  referenced_message?: RawMessage | null;
}

export interface RawChannel {
  id: string;
  name?: string;
  type: number;
  parent_id?: string | null;
  topic?: string | null;
  position?: number;
}

/** Trimmed, model-friendly view of a Discord message. */
export interface CleanMessage {
  id: string;
  author: string;
  author_id: string;
  is_bot: boolean;
  timestamp: string;
  edited: boolean;
  content: string;
  attachments: string[];
  reply_to?: string;
}

async function discordFetch<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "User-Agent": "DnD-Discord-MCP (Cloudflare Worker, v0.1)",
    },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after") ?? "?";
    throw new Error(`Discord rate limited (429). Retry after ${retryAfter}s.`);
  }
  if (res.status === 401 || res.status === 403) {
    const body = await res.text();
    throw new Error(
      `Discord auth/permission error (${res.status}) for ${path}. ` +
        `Check the bot token and that the bot has been invited to the server with ` +
        `View Channel + Read Message History permissions. Response: ${body.slice(0, 200)}`
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API ${res.status} ${res.statusText} for ${path}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export function cleanMessage(m: RawMessage): CleanMessage {
  return {
    id: m.id,
    author: m.author?.global_name || m.author?.username || "unknown",
    author_id: m.author?.id ?? "",
    is_bot: Boolean(m.author?.bot),
    timestamp: m.timestamp,
    edited: Boolean(m.edited_timestamp),
    content: m.content ?? "",
    attachments: (m.attachments ?? []).map((a) => a.url),
    reply_to: m.referenced_message?.id,
  };
}

export function cleanChannel(c: RawChannel) {
  return {
    id: c.id,
    name: c.name ?? "(unnamed)",
    type: c.type,
    parent_id: c.parent_id ?? null,
    topic: c.topic ?? null,
  };
}

export async function listChannels(env: Env, guildId: string): Promise<RawChannel[]> {
  const channels = await discordFetch<RawChannel[]>(env, `/guilds/${guildId}/channels`);
  return channels
    .filter((c) => TEXTLIKE_CHANNEL_TYPES.has(c.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export async function getChannel(env: Env, channelId: string): Promise<RawChannel> {
  return discordFetch<RawChannel>(env, `/channels/${channelId}`);
}

export async function getGuild(env: Env, guildId: string): Promise<unknown> {
  return discordFetch(env, `/guilds/${guildId}?with_counts=true`);
}

export interface HistoryOptions {
  limit?: number; // 1-100
  before?: string;
  after?: string;
}

export async function getMessages(
  env: Env,
  channelId: string,
  opts: HistoryOptions = {}
): Promise<RawMessage[]> {
  const params = new URLSearchParams();
  params.set("limit", String(Math.min(Math.max(opts.limit ?? 50, 1), 100)));
  if (opts.before) params.set("before", opts.before);
  if (opts.after) params.set("after", opts.after);
  const messages = await discordFetch<RawMessage[]>(
    env,
    `/channels/${channelId}/messages?${params.toString()}`
  );
  // Discord returns newest-first; return chronological (oldest-first).
  return messages.reverse();
}

export async function getPins(env: Env, channelId: string): Promise<RawMessage[]> {
  const pins = await discordFetch<RawMessage[]>(env, `/channels/${channelId}/pins`);
  return pins.reverse();
}

/**
 * Server-side message search by paging through channel history and filtering.
 * Discord's native /messages/search is Elasticsearch-backed and gated, so we
 * scan recent history instead (bounded by maxScan).
 */
export async function searchMessages(
  env: Env,
  channelId: string,
  opts: { query?: string; authorId?: string; maxScan?: number; limit?: number }
): Promise<CleanMessage[]> {
  const query = opts.query?.toLowerCase();
  const maxScan = Math.min(Math.max(opts.maxScan ?? 300, 1), 1000);
  const wanted = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  const matches: CleanMessage[] = [];
  let before: string | undefined;
  let scanned = 0;

  while (scanned < maxScan && matches.length < wanted) {
    const batch = await getMessages(env, channelId, { limit: 100, before });
    if (batch.length === 0) break;
    scanned += batch.length;
    // batch is oldest-first after getMessages reverse; page using the oldest id.
    before = batch[0].id;

    for (const raw of batch) {
      const m = cleanMessage(raw);
      const matchesQuery = query ? m.content.toLowerCase().includes(query) : true;
      const matchesAuthor = opts.authorId ? m.author_id === opts.authorId : true;
      if (matchesQuery && matchesAuthor) matches.push(m);
    }
    if (batch.length < 100) break; // reached the start of the channel
  }

  // Newest matches first for relevance.
  return matches
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
    .slice(0, wanted);
}

export interface RawMember {
  user?: { id: string; username: string; global_name?: string | null; bot?: boolean };
  nick?: string | null;
  roles?: string[];
  joined_at?: string;
}

export async function listMembers(env: Env, guildId: string, limit = 100): Promise<RawMember[]> {
  const capped = Math.min(Math.max(limit, 1), 1000);
  return discordFetch<RawMember[]>(env, `/guilds/${guildId}/members?limit=${capped}`);
}

/** Resolve a channel argument that may be an ID or a #name into a channel ID. */
export async function resolveChannelId(
  env: Env,
  guildId: string,
  channelRef: string
): Promise<string> {
  const ref = channelRef.trim().replace(/^#/, "");
  // Looks like a snowflake ID already.
  if (/^\d{5,}$/.test(ref)) return ref;

  const channels = await listChannels(env, guildId);
  const match = channels.find((c) => (c.name ?? "").toLowerCase() === ref.toLowerCase());
  if (!match) {
    const names = channels.map((c) => `#${c.name}`).join(", ");
    throw new Error(`No channel named "${channelRef}" in guild ${guildId}. Available: ${names}`);
  }
  return match.id;
}
