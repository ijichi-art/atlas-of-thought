import type {
  NormalizedMessage,
  NormalizedRole,
  ParseIssue,
  ParseResult,
} from "./types";

// Claude Code session log format. Files live at
//   ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
// Each line is a JSON event. Relevant types for conversation content:
//   - "user": message.content is a string
//   - "assistant": message.content is an array of content blocks
// We skip everything else (file snapshots, permission-mode changes, etc.).

type RawContentBlock = {
  type?: string;
  text?: string;
};

type RawMessage =
  | { role?: string; content?: string }
  | { role?: string; content?: RawContentBlock[] };

type RawEvent = {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  isSidechain?: boolean;
  message?: RawMessage;
};

const ROLE_MAP: Record<string, NormalizedRole> = {
  user: "user",
  assistant: "assistant",
};

function parseIsoDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function extractText(msg: RawMessage | undefined): string {
  if (!msg || typeof msg !== "object") return "";
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && (b as RawContentBlock).type === "text" && typeof (b as RawContentBlock).text === "string"
        ? (b as RawContentBlock).text!
        : ""))
      .filter((s) => s.length > 0)
      .join("\n\n");
  }
  return "";
}

type ParseOptions = {
  // Override the external id / title (e.g. when the caller already knows the
  // session UUID from the filename or wants a nicer title from the project dir).
  externalId?: string;
  title?: string;
  // Skip "sidechain" events (Task tool sub-agent conversations) — on by default.
  skipSidechain?: boolean;
};

export function parseClaudeCodeLog(
  raw: string,
  opts: ParseOptions = {},
): ParseResult {
  const issues: ParseIssue[] = [];
  const skipSidechain = opts.skipSidechain ?? true;
  const lines = raw.split("\n");

  const events: RawEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as RawEvent);
    } catch {
      issues.push({
        level: "warning",
        code: "invalid_line",
        message: `Line ${i + 1} is not valid JSON — skipped.`,
      });
    }
  }

  const messages: NormalizedMessage[] = [];
  let sessionId = opts.externalId;
  let firstTimestamp: Date | undefined;

  for (const ev of events) {
    if (!sessionId && ev.sessionId) sessionId = ev.sessionId;
    if (!firstTimestamp) firstTimestamp = parseIsoDate(ev.timestamp);
    if (skipSidechain && ev.isSidechain) continue;

    const role = ROLE_MAP[ev.type ?? ""];
    if (!role) continue;

    const text = extractText(ev.message);
    if (!text) continue;

    messages.push({ role, text, createdAt: parseIsoDate(ev.timestamp) });
  }

  if (!sessionId) {
    issues.push({
      level: "error",
      code: "no_session_id",
      message: "Could not determine session id from JSONL events; pass externalId explicitly.",
    });
    return { conversations: [], issues };
  }

  if (messages.length === 0) {
    issues.push({
      level: "warning",
      code: "no_renderable_messages",
      message: "Session contained no user/assistant text messages.",
      conversationId: sessionId,
    });
    return { conversations: [], issues };
  }

  // Synthesize a title from the first user message if none provided.
  const title =
    opts.title?.trim() ||
    messages.find((m) => m.role === "user")?.text.split("\n")[0].slice(0, 80) ||
    "(untitled Claude Code session)";

  return {
    conversations: [
      {
        source: "claude_code",
        externalId: sessionId,
        title,
        createdAt: firstTimestamp,
        messages,
      },
    ],
    issues,
  };
}
