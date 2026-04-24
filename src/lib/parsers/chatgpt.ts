import type {
  NormalizedConversation,
  NormalizedMessage,
  NormalizedRole,
  ParseIssue,
  ParseResult,
} from "./types";

// ChatGPT export format (conversations.json).
// Each conversation is a tree of messages — ChatGPT's "regenerate" feature
// creates branching. We walk from `current_node` up to the root to extract
// the currently-selected path, then reverse to get chronological order.

type RawAuthor = {
  role?: string;
  name?: string | null;
  metadata?: unknown;
};

type RawContent = {
  content_type?: string;
  parts?: unknown[];
  text?: string;
};

type RawMessage = {
  id?: string;
  author?: RawAuthor;
  create_time?: number | null;
  content?: RawContent;
  status?: string;
  end_turn?: boolean | null;
  metadata?: Record<string, unknown>;
};

type RawNode = {
  id: string;
  parent?: string | null;
  children?: string[];
  message?: RawMessage | null;
};

type RawConversation = {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number | null;
  update_time?: number | null;
  mapping?: Record<string, RawNode>;
  current_node?: string | null;
};

const ROLE_MAP: Record<string, NormalizedRole> = {
  user: "user",
  assistant: "assistant",
  system: "system",
  tool: "tool",
};

function secondsToDate(s: number | null | undefined): Date | undefined {
  if (typeof s !== "number" || !Number.isFinite(s)) return undefined;
  return new Date(s * 1000);
}

function extractText(content: RawContent | undefined): string {
  if (!content) return "";

  // `text` is used by some content types (code blocks, execution output).
  if (typeof content.text === "string" && content.text.length > 0) {
    return content.text;
  }

  const parts = content.parts;
  if (!Array.isArray(parts)) return "";

  // parts can be strings (text) or objects (image_asset_pointer, audio, etc.)
  // Strings are concatenated; non-text objects are skipped (not lost forever —
  // they're still in the raw export — but we surface only text for the demo.)
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        // Some objects have a `text` field (e.g. quote blocks).
        const maybeText = (p as { text?: unknown }).text;
        if (typeof maybeText === "string") return maybeText;
      }
      return "";
    })
    .filter((s) => s.length > 0)
    .join("\n\n");
}

function collectPath(
  mapping: Record<string, RawNode>,
  leafId: string,
): RawNode[] {
  const path: RawNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor) {
    if (seen.has(cursor)) break; // defend against cycles in malformed exports
    seen.add(cursor);
    const node: RawNode | undefined = mapping[cursor];
    if (!node) break;
    path.push(node);
    cursor = node.parent ?? null;
  }
  return path.reverse();
}

function isHiddenSystemMessage(msg: RawMessage): boolean {
  // ChatGPT's own UI suppresses system instructions with this metadata flag.
  // Keeping them would pollute the geography with content the user never saw.
  const meta = msg.metadata;
  if (!meta || typeof meta !== "object") return false;
  return Boolean((meta as { is_visually_hidden_from_conversation?: unknown }).is_visually_hidden_from_conversation);
}

function normalizeOne(raw: RawConversation, issues: ParseIssue[]): NormalizedConversation | null {
  const mapping = raw.mapping;
  const leaf = raw.current_node;
  const externalId = raw.conversation_id ?? raw.id;
  if (!mapping || !leaf || !externalId) {
    issues.push({
      level: "warning",
      code: "empty_conversation",
      message: "Conversation missing mapping / current_node / id — skipped.",
      conversationId: externalId,
    });
    return null;
  }

  const messages: NormalizedMessage[] = [];
  for (const node of collectPath(mapping, leaf)) {
    const msg = node.message;
    if (!msg || !msg.author) continue;
    if (isHiddenSystemMessage(msg)) continue;

    const role = ROLE_MAP[msg.author.role ?? ""];
    if (!role) continue; // unknown roles (e.g. plugins we don't model yet)

    const text = extractText(msg.content);
    if (!text) continue; // skip empties (image-only turns, tool stubs, etc.)

    messages.push({ role, text, createdAt: secondsToDate(msg.create_time) });
  }

  if (messages.length === 0) {
    issues.push({
      level: "warning",
      code: "no_renderable_messages",
      message: "Conversation had no text content after filtering — skipped.",
      conversationId: externalId,
    });
    return null;
  }

  return {
    source: "chatgpt",
    externalId,
    title: raw.title?.trim() || "(untitled)",
    createdAt: secondsToDate(raw.create_time),
    messages,
  };
}

export function parseChatGPTExport(input: unknown): ParseResult {
  const issues: ParseIssue[] = [];

  // Accept either a top-level array or a single-conversation object.
  const list: unknown[] = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : [];
  if (list.length === 0) {
    issues.push({
      level: "error",
      code: "unrecognized_input",
      message: "Input is not a ChatGPT conversations.json array or object.",
    });
    return { conversations: [], issues };
  }

  const conversations: NormalizedConversation[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const normalized = normalizeOne(raw as RawConversation, issues);
    if (normalized) conversations.push(normalized);
  }
  return { conversations, issues };
}
