import type { ParseResult } from "./types";
import { parseChatGPTExport } from "./chatgpt";
import { parseClaudeExport } from "./claude";
import { parseClaudeCodeLog } from "./claude-code";
import { parsePastedTranscript } from "./paste";

export type KnownSource = "chatgpt" | "claude" | "claude_code" | "paste";

// Heuristic: peek at the raw string to guess its format.
export function detectSource(raw: string): KnownSource {
  const trimmed = raw.trimStart();

  // JSON array → Claude or ChatGPT export
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return "paste";
    }
    const first = (Array.isArray(parsed) ? parsed[0] : null) as Record<string, unknown> | null;
    if (!first || typeof first !== "object") return "paste";
    if ("chat_messages" in first) return "claude";
    if ("mapping" in first) return "chatgpt";
    return "paste";
  }

  if (trimmed.startsWith("{")) {
    // Check for JSONL first: multiple { lines → Claude Code session
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length > 1 && lines[1].trim().startsWith("{")) {
      try {
        const obj = JSON.parse(lines[0]) as Record<string, unknown>;
        if (typeof obj.type === "string") return "claude_code";
      } catch {
        // fall through
      }
    }

    // Single JSON object → Claude or ChatGPT (single-conversation form)
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Could still be single-line JSONL
      try {
        const obj = JSON.parse(lines[0]) as Record<string, unknown>;
        if (typeof obj.type === "string") return "claude_code";
      } catch {
        // ignore
      }
      return "paste";
    }
    const obj = parsed as Record<string, unknown>;
    if ("chat_messages" in obj) return "claude";
    if ("mapping" in obj) return "chatgpt";
    return "paste";
  }

  return "paste";
}

type ParseOptions = {
  source?: KnownSource | "auto";
  externalId?: string;
  title?: string;
};

export function parseContent(raw: string, opts: ParseOptions = {}): ParseResult {
  const source: KnownSource =
    !opts.source || opts.source === "auto" ? detectSource(raw) : opts.source;

  switch (source) {
    case "claude": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          conversations: [],
          issues: [{ level: "error", code: "json_parse_error", message: "Could not parse JSON." }],
        };
      }
      return parseClaudeExport(parsed);
    }
    case "chatgpt": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return {
          conversations: [],
          issues: [{ level: "error", code: "json_parse_error", message: "Could not parse JSON." }],
        };
      }
      return parseChatGPTExport(parsed);
    }
    case "claude_code":
      return parseClaudeCodeLog(raw, { externalId: opts.externalId, title: opts.title });
    case "paste":
    default:
      return parsePastedTranscript(raw, { externalId: opts.externalId, title: opts.title });
  }
}
