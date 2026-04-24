import { describe, expect, it } from "vitest";
import { parseClaudeCodeLog } from "./claude-code";

function jsonl(events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n");
}

describe("parseClaudeCodeLog", () => {
  it("extracts user + assistant turns from a typical session", () => {
    const raw = jsonl([
      { type: "permission-mode", sessionId: "sess-1", permissionMode: "default" },
      {
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-04-22T19:17:49.144Z",
        message: { role: "user", content: "write a hello world" },
      },
      {
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-04-22T19:17:50.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "here you go" }, { type: "tool_use", name: "Write" }],
        },
      },
      { type: "file-history-snapshot", sessionId: "sess-1" },
    ]);

    const { conversations, issues } = parseClaudeCodeLog(raw);
    expect(issues).toEqual([]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].source).toBe("claude_code");
    expect(conversations[0].externalId).toBe("sess-1");
    expect(conversations[0].messages).toEqual([
      {
        role: "user",
        text: "write a hello world",
        createdAt: new Date("2026-04-22T19:17:49.144Z"),
      },
      {
        role: "assistant",
        text: "here you go",
        createdAt: new Date("2026-04-22T19:17:50.000Z"),
      },
    ]);
  });

  it("synthesizes a title from the first user message when none given", () => {
    const raw = jsonl([
      {
        type: "user",
        sessionId: "sess-1",
        message: { role: "user", content: "this line becomes the title\nsecond line" },
      },
      { type: "assistant", sessionId: "sess-1", message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    ]);

    const { conversations } = parseClaudeCodeLog(raw);
    expect(conversations[0].title).toBe("this line becomes the title");
  });

  it("honors caller-supplied externalId and title overrides", () => {
    const raw = jsonl([
      { type: "user", message: { role: "user", content: "hi" } },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
    ]);

    const { conversations } = parseClaudeCodeLog(raw, { externalId: "override", title: "My label" });
    expect(conversations[0].externalId).toBe("override");
    expect(conversations[0].title).toBe("My label");
  });

  it("skips sidechain (sub-agent) events by default", () => {
    const raw = jsonl([
      { type: "user", sessionId: "s", message: { role: "user", content: "main question" } },
      { type: "user", sessionId: "s", isSidechain: true, message: { role: "user", content: "sub-agent prompt" } },
      { type: "assistant", sessionId: "s", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "sub-agent answer" }] } },
      { type: "assistant", sessionId: "s", message: { role: "assistant", content: [{ type: "text", text: "main answer" }] } },
    ]);

    const { conversations } = parseClaudeCodeLog(raw);
    expect(conversations[0].messages.map((m) => m.text)).toEqual(["main question", "main answer"]);
  });

  it("includes sidechain events when skipSidechain=false", () => {
    const raw = jsonl([
      { type: "user", sessionId: "s", message: { role: "user", content: "main" } },
      { type: "assistant", sessionId: "s", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "sub" }] } },
    ]);

    const { conversations } = parseClaudeCodeLog(raw, { skipSidechain: false });
    expect(conversations[0].messages.map((m) => m.text)).toEqual(["main", "sub"]);
  });

  it("tolerates invalid JSON lines with a warning", () => {
    const raw = [
      JSON.stringify({ type: "user", sessionId: "s", message: { role: "user", content: "ok" } }),
      "this is not JSON",
      JSON.stringify({ type: "assistant", sessionId: "s", message: { role: "assistant", content: [{ type: "text", text: "fine" }] } }),
    ].join("\n");

    const { conversations, issues } = parseClaudeCodeLog(raw);
    expect(conversations[0].messages).toHaveLength(2);
    expect(issues.find((i) => i.code === "invalid_line")).toBeTruthy();
  });

  it("errors when no session id can be derived", () => {
    const raw = jsonl([
      { type: "user", message: { role: "user", content: "hi" } },
    ]);
    const { conversations, issues } = parseClaudeCodeLog(raw);
    expect(conversations).toHaveLength(0);
    expect(issues.find((i) => i.code === "no_session_id")).toBeTruthy();
  });
});
