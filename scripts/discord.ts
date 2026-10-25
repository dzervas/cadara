// Minimal Discord REST client for the community skills (changelog-post,
// trial-post, trial-harvest). Everything is on-demand REST with a bot token;
// there is no gateway connection, so nothing has to stay online.
//
// Environment (Bun loads .env automatically):
//   DISCORD_BOT_TOKEN            bot token
//   DISCORD_CHANGELOG_CHANNEL_ID text/announcement channel for changelog posts
//   DISCORD_TESTING_CHANNEL_ID   forum or text channel for human-trial threads
//
// Reading other users' replies needs the privileged "Message Content" intent
// enabled on the bot in the developer portal; without it content comes back empty.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const usage = `Usage: bun scripts/discord.ts <command> [options]

Commands:
  last-changelog                      Latest bot message in the changelog channel (JSON)
  post-changelog <file> [--attach F]  Post a Markdown file to the changelog channel
  post-trial <file> --title T [--attach F]
                                      Open a thread in the testing channel
  list-trials                         Threads in the testing channel (JSON)
  read-thread <thread-id>             All messages in a thread, oldest first (JSON)
  reply <thread-id> <file> [--attach F]
                                      Post a Markdown file into a thread
  react <channel-id> <message-id> <emoji>

<file> may be "-" to read stdin. Messages are limited to 2000 characters;
link previews and mentions are suppressed on everything the bot posts.`;

const api = "https://discord.com/api/v10";
const suppressEmbeds = 1 << 2;
const forumChannelType = 15;
const messageLimit = 2000;

type Message = {
  id: string;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
  attachments: { url: string; filename: string }[];
  reactions?: { emoji: { name: string }; count: number; me: boolean }[];
};
type Channel = { id: string; type: number; guild_id: string; name: string };
type Thread = Channel & {
  parent_id: string;
  thread_metadata: { archived: boolean };
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  for (;;) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${env("DISCORD_BOT_TOKEN")}`,
        ...(body instanceof FormData || body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body instanceof FormData || body === undefined
          ? body
          : JSON.stringify(body),
    });
    if (response.status === 429) {
      const { retry_after } = (await response.json()) as {
        retry_after: number;
      };
      await delay(Math.ceil(retry_after * 1000));
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `${method} ${path} -> ${response.status}: ${await response.text()}`,
      );
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }
}

function readContent(file: string): string {
  const content = readFileSync(file === "-" ? 0 : file, "utf8").trim();
  if (content.length > messageLimit) {
    throw new Error(
      `Message is ${content.length} characters; Discord allows ${messageLimit}`,
    );
  }
  return content;
}

function messageBody(content: string) {
  return { content, flags: suppressEmbeds, allowed_mentions: { parse: [] } };
}

// Returns a JSON body, or multipart when a file is attached. `wrap` places the
// message inside a larger payload (forum threads nest it under `message`).
function withAttachment(
  content: string,
  attach: string | undefined,
  wrap: (message: object) => object = (message) => message,
): object | FormData {
  if (!attach) return wrap(messageBody(content));
  const filename = basename(attach);
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify(
      wrap({ ...messageBody(content), attachments: [{ id: 0, filename }] }),
    ),
  );
  form.set("files[0]", new Blob([readFileSync(attach)]), filename);
  return form;
}

async function postMessage(
  channelId: string,
  content: string,
  attach?: string,
) {
  return request<Message>(
    "POST",
    `/channels/${channelId}/messages`,
    withAttachment(content, attach),
  );
}

async function readMessages(channelId: string): Promise<Message[]> {
  const messages: Message[] = [];
  let after = "0";
  for (;;) {
    const page = await request<Message[]>(
      "GET",
      `/channels/${channelId}/messages?limit=100&after=${after}`,
    );
    if (page.length === 0) break;
    messages.push(...page);
    after = page.reduce(
      (max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max),
      after,
    );
  }
  return messages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

function summarize(message: Message) {
  return {
    id: message.id,
    timestamp: message.timestamp,
    author: message.author.global_name ?? message.author.username,
    fromBot: message.author.bot === true,
    content: message.content,
    attachments: message.attachments.map((a) => a.url),
    reactions: (message.reactions ?? []).map((r) => ({
      emoji: r.emoji.name,
      count: r.count,
      mine: r.me,
    })),
  };
}

const commands: Record<
  string,
  (args: string[], attach?: string, title?: string) => Promise<unknown>
> = {
  async "last-changelog"() {
    const me = await request<{ id: string }>("GET", "/users/@me");
    const recent = await request<Message[]>(
      "GET",
      `/channels/${env("DISCORD_CHANGELOG_CHANNEL_ID")}/messages?limit=50`,
    );
    const last = recent.find((m) => m.author.id === me.id);
    return last ? summarize(last) : null;
  },

  async "post-changelog"([file], attach) {
    const message = await postMessage(
      env("DISCORD_CHANGELOG_CHANNEL_ID"),
      readContent(file),
      attach,
    );
    return summarize(message);
  },

  async "post-trial"([file], attach, title) {
    if (!title) throw new Error("post-trial needs --title");
    const channelId = env("DISCORD_TESTING_CHANNEL_ID");
    const content = readContent(file);
    const channel = await request<Channel>("GET", `/channels/${channelId}`);
    if (channel.type === forumChannelType) {
      const thread = await request<Thread>(
        "POST",
        `/channels/${channelId}/threads`,
        withAttachment(content, attach, (message) => ({
          name: title,
          message,
        })),
      );
      return { threadId: thread.id, name: thread.name };
    }
    const starter = await postMessage(channelId, content, attach);
    const thread = await request<Thread>(
      "POST",
      `/channels/${channelId}/messages/${starter.id}/threads`,
      { name: title },
    );
    return { threadId: thread.id, name: thread.name };
  },

  async "list-trials"() {
    const channelId = env("DISCORD_TESTING_CHANNEL_ID");
    const channel = await request<Channel>("GET", `/channels/${channelId}`);
    const active = await request<{ threads: Thread[] }>(
      "GET",
      `/guilds/${channel.guild_id}/threads/active`,
    );
    const archived = await request<{ threads: Thread[] }>(
      "GET",
      `/channels/${channelId}/threads/archived/public?limit=100`,
    );
    return [
      ...active.threads.filter((t) => t.parent_id === channelId),
      ...archived.threads,
    ].map((t) => ({
      threadId: t.id,
      name: t.name,
      archived: t.thread_metadata.archived,
    }));
  },

  async "read-thread"([threadId]) {
    return (await readMessages(threadId)).map(summarize);
  },

  async reply([threadId, file], attach) {
    return summarize(await postMessage(threadId, readContent(file), attach));
  },

  async react([channelId, messageId, emoji]) {
    await request(
      "PUT",
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
    );
    return { ok: true };
  },
};

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    attach: { type: "string" },
    title: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
const [name, ...args] = positionals;
const command = name ? commands[name] : undefined;
if (values.help || !command) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}
console.log(
  JSON.stringify(await command(args, values.attach, values.title), null, 2),
);
