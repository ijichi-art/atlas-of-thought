import { describe, expect, it } from "vitest";
import { parseGeminiWorkspace } from "./gemini-workspace";
import { detectSource, parseContent } from "./index";

const FIXTURE = JSON.stringify({
  conversation_turns: [
    {
      user_turn: {
        prompt: "What's TCP slow start?",
        turn_index: 0,
        turn_last_modified: "2026-04-01T10:00:00.000000+00:00",
      },
    },
    {
      system_turn: {
        citations: [
          { display_text: "RFC 5681", url: "https://www.rfc-editor.org/rfc/rfc5681" },
        ],
        text: [{ data: "TCP slow start ramps up..." }],
        turn_index: 1,
        turn_last_modified: "2026-04-01T10:00:05.000000+00:00",
      },
    },
    {
      user_turn: {
        prompt: "And how does it interact with congestion avoidance?",
        turn_index: 2,
        turn_last_modified: "2026-04-01T10:01:00.000000+00:00",
      },
    },
    {
      system_turn: {
        text: [{ data: "Once cwnd >= ssthresh..." }],
        turn_index: 3,
        turn_last_modified: "2026-04-01T10:01:10.000000+00:00",
      },
    },
  ],
  creation_time: "2026-04-01T10:00:00.000000+00:00",
  last_modification_time: "2026-04-01T10:01:10.000000+00:00",
  title: "What's TCP slow start?",
});

describe("parseGeminiWorkspace", () => {
  it("returns one conversation with both user and assistant turns", () => {
    const out = parseGeminiWorkspace(FIXTURE);
    expect(out.conversations).toHaveLength(1);
    const conv = out.conversations[0];
    expect(conv.messages).toHaveLength(4);
    expect(conv.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("preserves the assistant text from system_turn.text[].data", () => {
    const out = parseGeminiWorkspace(FIXTURE);
    expect(out.conversations[0].messages[1].text).toContain("TCP slow start ramps up");
  });

  it("appends citations as a footnote on the assistant message", () => {
    const out = parseGeminiWorkspace(FIXTURE);
    expect(out.conversations[0].messages[1].text).toContain("[引用元]");
    expect(out.conversations[0].messages[1].text).toContain("RFC 5681");
  });

  it("titles the conversation from the JSON title field", () => {
    const out = parseGeminiWorkspace(FIXTURE);
    expect(out.conversations[0].title).toBe("What's TCP slow start?");
  });

  it("parses creation_time into createdAt", () => {
    const out = parseGeminiWorkspace(FIXTURE);
    const d = out.conversations[0].createdAt;
    expect(d?.toISOString()).toBe("2026-04-01T10:00:00.000Z");
  });

  it("rejects malformed JSON", () => {
    const out = parseGeminiWorkspace("{not json");
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("json_parse_error");
  });

  it("rejects JSON that lacks conversation_turns", () => {
    const out = parseGeminiWorkspace(JSON.stringify({ foo: "bar" }));
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("not_workspace_export");
  });
});

describe("integration: detectSource + parseContent route Workspace JSON correctly", () => {
  it("detects conversation_turns objects as 'gemini'", () => {
    expect(detectSource(FIXTURE)).toBe("gemini");
  });

  it("parseContent('gemini', JSON) routes to the Workspace parser", () => {
    const out = parseContent(FIXTURE, { source: "gemini" });
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations[0].messages).toHaveLength(4);
  });

  it("parseContent('auto', JSON) routes to the Workspace parser", () => {
    const out = parseContent(FIXTURE);
    expect(out.conversations).toHaveLength(1);
  });
});
