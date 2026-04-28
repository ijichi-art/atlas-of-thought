// Gemini in Workspace conversation parser.
//
// Distinct from the public Gemini Apps Takeout (which is HTML and prompt-only):
// this format is the export from Gemini side-panels in Gmail / Docs / Sheets.
// Files are named `conversation_NNN.txt` despite holding JSON. One file = one
// full conversation, including the model's responses and source citations.
//
// JSON shape:
//   {
//     "conversation_turns": [
//       { "user_turn":   { "prompt": "...", "turn_index": 0, "turn_last_modified": "..." } },
//       { "system_turn": { "text": [{ "data": "..." }], "citations": [...], "turn_index": 1, ... } },
//       ...
//     ],
//     "creation_time": "...",
//     "last_modification_time": "...",
//     "title": "..."
//   }

import type {
  NormalizedConversation,
  NormalizedMessage,
  ParseIssue,
  ParseResult,
} from "./types";

type UserTurn = {
  prompt?: string;
  turn_index?: number;
  turn_last_modified?: string;
};

type Citation = {
  display_text?: string;
  url?: string;
};

type SystemTurn = {
  text?: Array<{ data?: string }>;
  citations?: Citation[];
  turn_index?: number;
  turn_last_modified?: string;
};

type ConversationTurn = {
  user_turn?: UserTurn;
  system_turn?: SystemTurn;
};

type WorkspaceConversation = {
  conversation_turns?: ConversationTurn[];
  creation_time?: string;
  last_modification_time?: string;
  title?: string;
};

function safeDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Concatenate all text fragments from a system turn. Append citations as a
// trailing footnote so the cartographer LLM still sees what email/doc the
// answer was grounded in (useful for clustering by topic).
function systemTurnToText(turn: SystemTurn): string {
  const parts: string[] = [];
  for (const t of turn.text ?? []) {
    if (typeof t?.data === "string" && t.data.trim()) parts.push(t.data);
  }
  const body = parts.join("\n").trim();
  const cites = (turn.citations ?? [])
    .filter((c) => c?.display_text)
    .map((c) => `- ${c.display_text}`);
  if (cites.length === 0) return body;
  return `${body}\n\n[引用元]\n${cites.join("\n")}`.trim();
}

export function parseGeminiWorkspace(raw: string, filename?: string): ParseResult {
  const issues: ParseIssue[] = [];

  let parsed: WorkspaceConversation;
  try {
    parsed = JSON.parse(raw) as WorkspaceConversation;
  } catch (err) {
    return {
      conversations: [],
      issues: [
        {
          level: "error",
          code: "json_parse_error",
          message: `Could not parse JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.conversation_turns)) {
    return {
      conversations: [],
      issues: [
        {
          level: "error",
          code: "not_workspace_export",
          message: "Doesn't look like a Gemini in Workspace conversation export (missing conversation_turns array).",
        },
      ],
    };
  }

  const messages: NormalizedMessage[] = [];
  for (const turn of parsed.conversation_turns) {
    if (turn.user_turn) {
      const text = (turn.user_turn.prompt ?? "").trim();
      if (text) {
        messages.push({
          role: "user",
          text,
          createdAt: safeDate(turn.user_turn.turn_last_modified),
        });
      }
    } else if (turn.system_turn) {
      const text = systemTurnToText(turn.system_turn);
      if (text) {
        messages.push({
          role: "assistant",
          text,
          createdAt: safeDate(turn.system_turn.turn_last_modified),
        });
      }
    }
  }

  if (messages.length === 0) {
    issues.push({
      level: "warning",
      code: "empty_conversation",
      message: "Conversation has no usable turns.",
    });
    return { conversations: [], issues };
  }

  // ExternalId: prefer the filename (stable across re-imports of the same
  // export), otherwise hash the title + creation_time.
  const externalId =
    filename?.replace(/\.txt$/i, "").trim() ||
    `gemini-ws-${(parsed.title ?? "untitled").slice(0, 40)}-${parsed.creation_time ?? ""}`;

  const conv: NormalizedConversation = {
    source: "gemini",
    externalId,
    title: (parsed.title ?? messages[0].text ?? "Gemini conversation").slice(0, 120),
    createdAt: safeDate(parsed.creation_time),
    messages,
  };

  return { conversations: [conv], issues };
}
