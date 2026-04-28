import type { ParseResult } from "./types";
import { parseChatGPTExport, parseChatGPTHtml } from "./chatgpt";
import { parseClaudeExport } from "./claude";
import { parseClaudeCodeLog } from "./claude-code";
import { parsePastedTranscript } from "./paste";
import { parseGeminiHtml } from "./gemini";
import { parseGeminiWorkspace } from "./gemini-workspace";

export type KnownSource = "chatgpt" | "claude" | "claude_code" | "gemini" | "paste";

// Heuristic: peek at the raw string to guess its format.
export function detectSource(raw: string): KnownSource {
  const trimmed = raw.trimStart();

  // HTML — could be ChatGPT's chat.html OR a Google Takeout Gemini Apps export.
  // Distinguish by content sniffing in the first chunk.
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    /<div class="outer-cell/i.test(trimmed.slice(0, 5000))
  ) {
    const head = trimmed.slice(0, 5000);
    if (
      /var\s+jsonData\s*=\s*\[/.test(head) ||
      /<title>\s*ChatGPT Data Export\s*<\/title>/i.test(head)
    ) {
      return "chatgpt";
    }
    return "gemini";
  }

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

    // Single JSON object → Claude / ChatGPT (single-conversation) / Gemini Workspace
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
    if ("conversation_turns" in obj) return "gemini"; // Workspace export
    if ("chat_messages" in obj) return "claude";
    if ("mapping" in obj) return "chatgpt";
    // ChatGPT export_manifest.json — list of file paths, no conversation data.
    // Detected by the export_files array; routed to paste only so parseContent
    // can emit a clear "this is a manifest" error.
    if ("export_files" in obj && Array.isArray(obj.export_files)) return "paste";
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
  // Specific-format reject: ChatGPT's export_manifest.json is a file listing,
  // not conversations. Catch it up front so we don't dump a confusing
  // "no role labels" warning from the paste parser.
  const trimmedHead = raw.trimStart().slice(0, 1024);
  if (
    trimmedHead.startsWith("{") &&
    /"export_files"\s*:\s*\[/.test(trimmedHead)
  ) {
    return {
      conversations: [],
      issues: [
        {
          level: "error",
          code: "manifest_only",
          message:
            "This file is the ChatGPT export manifest (a list of file paths), not conversation data. Skip it and import the conversations-NNN.json files (or chat.html) instead.",
        },
      ],
    };
  }

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
      // Two formats land here: chat.html (single-file export with embedded
      // JSON) and conversations-NNN.json.
      const t = raw.trimStart();
      if (t.startsWith("<")) {
        return parseChatGPTHtml(raw);
      }
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
    case "gemini": {
      // Two distinct formats live under the same source:
      //   - HTML (Google Takeout "Gemini Apps Activity")
      //   - JSON in a .txt file (Gemini in Workspace conversation export)
      const t = raw.trimStart();
      if (t.startsWith("{") || t.startsWith("[")) {
        return parseGeminiWorkspace(raw);
      }
      return parseGeminiHtml(raw);
    }
    case "paste":
    default:
      return parsePastedTranscript(raw, { externalId: opts.externalId, title: opts.title });
  }
}
