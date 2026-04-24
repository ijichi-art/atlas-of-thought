import type {
  NormalizedConversation,
  NormalizedMessage,
  NormalizedRole,
  ParseIssue,
  ParseResult,
} from "./types";

// Claude.ai export format (conversations.json from claude.ai → settings → export).
// Unlike ChatGPT there's no tree — chat_messages is a flat linear list.
// Content may be a string (older exports) or an array of blocks (newer ones).

type RawContentBlock = {
  type?: string;
  text?: string;
};

type RawChatMessage = {
  uuid?: string;
  sender?: string;
  text?: string;
  content?: RawContentBlock[] | string;
  created_at?: string;
};

type RawClaudeConversation = {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: RawChatMessage[];
};

const SENDER_MAP: Record<string, NormalizedRole> = {
  human: "user",
  user: "user",
  assistant: "assistant",
};

function parseIsoDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function extractText(m: RawChatMessage): string {
  // Prefer the structured `content` blocks when present; fall back to `text`.
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (b && b.type === "text" && typeof b.text === "string" ? b.text : ""))
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  if (typeof m.content === "string" && m.content.length > 0) return m.content;
  if (typeof m.text === "string") return m.text;
  return "";
}

function normalizeOne(raw: RawClaudeConversation, issues: ParseIssue[]): NormalizedConversation | null {
  const externalId = raw.uuid;
  if (!externalId || !Array.isArray(raw.chat_messages)) {
    issues.push({
      level: "warning",
      code: "missing_fields",
      message: "Claude conversation missing uuid or chat_messages — skipped.",
      conversationId: externalId,
    });
    return null;
  }

  const messages: NormalizedMessage[] = [];
  for (const m of raw.chat_messages) {
    const role = SENDER_MAP[m.sender ?? ""];
    if (!role) continue;
    const text = extractText(m);
    if (!text) continue;
    messages.push({ role, text, createdAt: parseIsoDate(m.created_at) });
  }

  if (messages.length === 0) {
    issues.push({
      level: "warning",
      code: "no_renderable_messages",
      message: "Claude conversation had no text content — skipped.",
      conversationId: externalId,
    });
    return null;
  }

  return {
    source: "claude",
    externalId,
    title: raw.name?.trim() || "(untitled)",
    createdAt: parseIsoDate(raw.created_at),
    messages,
  };
}

export function parseClaudeExport(input: unknown): ParseResult {
  const issues: ParseIssue[] = [];
  const list: unknown[] = Array.isArray(input) ? input : input && typeof input === "object" ? [input] : [];
  if (list.length === 0) {
    issues.push({
      level: "error",
      code: "unrecognized_input",
      message: "Input is not a Claude conversations.json array or object.",
    });
    return { conversations: [], issues };
  }

  const conversations: NormalizedConversation[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const n = normalizeOne(raw as RawClaudeConversation, issues);
    if (n) conversations.push(n);
  }
  return { conversations, issues };
}
