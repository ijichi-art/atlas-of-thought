import type {
  NormalizedMessage,
  NormalizedRole,
  ParseIssue,
  ParseResult,
} from "./types";

// Free-form paste parser: user drops a transcript into a textarea and we turn
// it into a conversation. We look for common role-label patterns at the start
// of a line and split on them; if no labels are found we fall back to a single
// user message and warn.

type RoleLabel = { label: string; role: NormalizedRole };

// Order matters — longer / more-specific labels first.
const LABELS: RoleLabel[] = [
  { label: "assistant", role: "assistant" },
  { label: "claude", role: "assistant" },
  { label: "chatgpt", role: "assistant" },
  { label: "gpt", role: "assistant" },
  { label: "ai", role: "assistant" },
  { label: "bot", role: "assistant" },
  { label: "user", role: "user" },
  { label: "human", role: "user" },
  { label: "you", role: "user" },
  { label: "me", role: "user" },
  { label: "system", role: "system" },
];

// Detect a role-label at the start of a single line.
// Handles two forms:
//   1. `Label: rest`  (with `:` / `-` / en-/em-dash as separator)
//   2. `Label` alone  (markdown header: `## User`, bold: `**Claude**`, etc.)
// Strips common decorations (`#`, `*`, `[]`) before matching.
// Returns the matched role and the remaining text on that line, or null.
function splitLabel(line: string): { role: NormalizedRole; rest: string } | null {
  const stripped = line
    .replace(/^\s*#{1,6}\s*/, "") // markdown headers
    .replace(/^\s*\*+\s*/, "") // leading bold markers
    .replace(/\*+\s*$/, "") // trailing bold markers
    .replace(/^\s*\[([^\]]+)\]\s*:?\s*/, (_m, inner) => `${inner}: `) // [Label]
    .trim();

  // Form 1: `Label: rest` — also strip a trailing `**` between the colon and
  // the content (closes a `**Label:**` bold wrap).
  const withDelim = stripped.match(/^([A-Za-z][A-Za-z0-9 _-]{0,20})\s*[:\-–—]\s*(.*)$/);
  if (withDelim) {
    const candidate = withDelim[1].trim().toLowerCase().replace(/\s+/g, "");
    const label = LABELS.find((l) => candidate === l.label);
    if (!label) return null;
    const rest = withDelim[2].replace(/^\*+\s*/, "").trim();
    return { role: label.role, rest };
  }

  // Form 2: label-only line (after stripping decorations, nothing else)
  const whole = stripped.toLowerCase().replace(/\s+/g, "");
  const label = LABELS.find((l) => whole === l.label);
  return label ? { role: label.role, rest: "" } : null;
}

type ParseOptions = {
  externalId?: string;
  title?: string;
};

export function parsePastedTranscript(raw: string, opts: ParseOptions = {}): ParseResult {
  const issues: ParseIssue[] = [];
  const trimmed = raw.trim();
  if (!trimmed) {
    issues.push({ level: "error", code: "empty_input", message: "Nothing pasted." });
    return { conversations: [], issues };
  }

  const lines = trimmed.split(/\r?\n/);
  const messages: NormalizedMessage[] = [];
  let currentRole: NormalizedRole | null = null;
  let currentBuf: string[] = [];
  let seenLabel = false;

  const flush = () => {
    if (!currentRole) return;
    const text = currentBuf.join("\n").trim();
    if (text) messages.push({ role: currentRole, text });
    currentBuf = [];
  };

  for (const line of lines) {
    const split = splitLabel(line);
    if (split) {
      flush();
      currentRole = split.role;
      seenLabel = true;
      if (split.rest) currentBuf.push(split.rest);
    } else {
      if (!currentRole) {
        // Text before any label — treat as a user preamble.
        currentRole = "user";
      }
      currentBuf.push(line);
    }
  }
  flush();

  if (!seenLabel) {
    issues.push({
      level: "warning",
      code: "no_role_labels",
      message:
        'No role labels (User:/Assistant:/etc.) detected — treating the entire paste as one user message.',
    });
  }

  if (messages.length === 0) {
    issues.push({
      level: "error",
      code: "empty_after_parse",
      message: "Pasted text produced no messages.",
    });
    return { conversations: [], issues };
  }

  const externalId =
    opts.externalId ??
    `paste-${new Date().toISOString().replace(/[^\dTZ]/g, "").slice(0, 15)}`;
  const title =
    opts.title?.trim() ||
    messages.find((m) => m.role === "user")?.text.split("\n")[0].slice(0, 80) ||
    "(pasted conversation)";

  return {
    conversations: [
      {
        source: "manual",
        externalId,
        title,
        messages,
      },
    ],
    issues,
  };
}
