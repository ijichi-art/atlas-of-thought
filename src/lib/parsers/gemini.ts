// Google Takeout HTML parser for Gemini Apps Activity.
//
// Takeout exports each Gemini interaction as an "outer-cell" block in a
// machine-generated HTML file. The structure is consistent enough that
// regex-based extraction is reliable without pulling in a full HTML parser.
//
// What we extract per activity:
//   - prompt text (always present)
//   - timestamp (when present in the cell)
//   - assistant response text (when Takeout includes it; many exports don't)
//
// One Takeout activity = one normalized conversation. Each conversation gets
// the prompt as a user message and, if available, the response as an
// assistant message.

import type {
  NormalizedConversation,
  NormalizedMessage,
  ParseIssue,
  ParseResult,
} from "./types";

// Each Takeout activity is wrapped in a div with class "outer-cell".
// We split on the opening tag of these divs and treat each segment as one
// activity block. Closing div nesting is irrelevant for extraction below.
const OUTER_CELL_OPEN = /<div class="outer-cell[^"]*"/g;

// Header cell — confirms this block is a Gemini Apps activity (Takeout
// bundles other products in the same export sometimes).
const GEMINI_HEADER = /Gemini Apps|Bard/i;

// Body content cell that holds the prompt + timestamp.
const BODY_CELL = /<div class="content-cell[^"]*mdl-typography--body-1[^"]*">([\s\S]*?)<\/div>/i;

// Some exports have a second body cell with the response (variable layout).
const ALL_BODY_CELLS_GLOBAL = /<div class="content-cell[^"]*mdl-typography--body-1[^"]*">([\s\S]*?)<\/div>/gi;

// Date pattern: "Apr 12, 2026, 10:53:24 AM JST" or "2026年4月12日 10:53:24 JST"
const DATE_EN = /\b([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})[,\s]+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)\s+([A-Z]{2,5})\b/;
const DATE_JA = /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2}):(\d{2})/;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)));
}

// Strip HTML tags but preserve <br> as newlines so multi-line prompts
// survive. Drop <a> contents that are just "Open in Gemini" affordances.
function htmlToText(html: string): string {
  return decodeEntities(
    html
      // <a href="...gemini.google.com...">Open in Gemini</a> → drop entirely
      .replace(/<a [^>]*?gemini\.google\.com[^>]*?>[\s\S]*?<\/a>/gi, "")
      // newline preservation
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      // strip remaining tags
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Try to lift a Date out of arbitrary plain text.
function parseTakeoutDate(text: string): Date | null {
  const en = DATE_EN.exec(text);
  if (en) {
    // Construct a parseable string: "Apr 12 2026 10:53:24 AM" — drop tz
    // (Date constructor handles AM/PM with English month name).
    const s = `${en[1]} ${en[2]} ${en[3]} ${en[4]}:${en[5]}:${en[6]} ${en[7]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const ja = DATE_JA.exec(text);
  if (ja) {
    const d = new Date(
      Number(ja[1]),
      Number(ja[2]) - 1,
      Number(ja[3]),
      Number(ja[4]),
      Number(ja[5]),
      Number(ja[6]),
    );
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// Decide which cell holds the prompt and which (if any) holds the response.
// Heuristic: the first body cell with "Prompted" / "Asked" / "保存しました" /
// non-trivial text is the prompt; subsequent body cells without timestamp-like
// content are treated as response.
function splitPromptAndResponse(blockHtml: string): {
  promptHtml: string | null;
  responseHtml: string | null;
} {
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  ALL_BODY_CELLS_GLOBAL.lastIndex = 0;
  while ((m = ALL_BODY_CELLS_GLOBAL.exec(blockHtml)) !== null) {
    cells.push(m[1]);
  }
  if (cells.length === 0) return { promptHtml: null, responseHtml: null };
  if (cells.length === 1) return { promptHtml: cells[0], responseHtml: null };
  // Two or more body cells: assume cell[0] = prompt, cell[1] = response.
  return { promptHtml: cells[0], responseHtml: cells[1] };
}

// Stable per-activity id for dedupe: hash the (prompt + timestamp). Avoids
// re-importing the same activities when a second Takeout arrives.
function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `gemini-${(h >>> 0).toString(36)}`;
}

export function parseGeminiHtml(raw: string): ParseResult {
  const conversations: NormalizedConversation[] = [];
  const issues: ParseIssue[] = [];

  // Split on outer-cell boundaries. The matchAll approach gives us the
  // start index of each block; we slice to the next block's start.
  const matches: Array<{ index: number }> = [];
  OUTER_CELL_OPEN.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = OUTER_CELL_OPEN.exec(raw)) !== null) {
    matches.push({ index: mm.index });
  }

  if (matches.length === 0) {
    issues.push({
      level: "error",
      code: "no_outer_cells",
      message:
        "No <div class=\"outer-cell\"> blocks found. This file doesn't look like a Google Takeout HTML export.",
    });
    return { conversations, issues };
  }

  let geminiBlocks = 0;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    const block = raw.slice(start, end);

    if (!GEMINI_HEADER.test(block)) continue;
    geminiBlocks++;

    const { promptHtml, responseHtml } = splitPromptAndResponse(block);
    if (!promptHtml) continue;

    const promptTextRaw = htmlToText(promptHtml);
    // Strip leading "Prompted ", "Asked Gemini: ", "Saved ", etc.
    const promptText = promptTextRaw
      .replace(/^\s*(Prompted\b\s*:?|Asked Gemini\b\s*:?|Saved\b\s*:?|入力\s*:?)\s*/i, "")
      .trim();
    if (!promptText) continue;

    // Timestamp lives at the bottom of the prompt cell in Takeout.
    const createdAt = parseTakeoutDate(promptTextRaw);
    // Strip the trailing date line from the prompt body so it doesn't
    // appear as part of the user message.
    const dateLineRegex = createdAt ? /\n[^\n]*\b(?:AM|PM)\b[^\n]*$|\n\d{4}年[^\n]*$/m : null;
    const promptClean = dateLineRegex
      ? promptText.replace(dateLineRegex, "").trim()
      : promptText;

    const messages: NormalizedMessage[] = [
      {
        role: "user",
        text: promptClean,
        createdAt: createdAt ?? undefined,
      },
    ];

    if (responseHtml) {
      const respText = htmlToText(responseHtml).trim();
      if (respText && respText !== promptClean) {
        messages.push({ role: "assistant", text: respText });
      }
    }

    const titleSource = promptClean.replace(/\s+/g, " ").trim();
    const title = titleSource.length > 80 ? titleSource.slice(0, 77) + "…" : titleSource;
    const externalId = hashId(`${promptClean}|${createdAt?.toISOString() ?? ""}`);

    conversations.push({
      source: "gemini",
      externalId,
      title,
      createdAt: createdAt ?? undefined,
      messages,
    });
  }

  if (geminiBlocks === 0) {
    issues.push({
      level: "error",
      code: "no_gemini_activities",
      message:
        "Found Takeout activity blocks but none mention Gemini Apps. Make sure you exported \"Gemini Apps Activity\" specifically.",
    });
  } else if (conversations.length === 0) {
    issues.push({
      level: "warning",
      code: "no_prompts_extracted",
      message: `Found ${geminiBlocks} Gemini activities but couldn't extract a prompt from any. The export format may have changed — please share a sample.`,
    });
  }

  return { conversations, issues };
}
