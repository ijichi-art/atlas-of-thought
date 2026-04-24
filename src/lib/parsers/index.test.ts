import { describe, expect, it } from "vitest";
import { detectSource, parseContent } from "./index";

const claudeExport = JSON.stringify([
  {
    uuid: "c1",
    name: "Demo",
    created_at: "2024-01-01T00:00:00.000Z",
    chat_messages: [
      { sender: "human", content: [{ type: "text", text: "hi" }] },
      { sender: "assistant", content: [{ type: "text", text: "hello" }] },
    ],
  },
]);

const chatgptExport = JSON.stringify([
  {
    id: "g1",
    title: "Demo",
    mapping: {
      n1: { id: "n1", message: null, parent: null, children: ["n2"] },
      n2: {
        id: "n2",
        parent: "n1",
        children: [],
        message: { id: "n2", role: "user", author: { role: "user" }, content: { content_type: "text", parts: ["hello"] } },
      },
    },
    current_node: "n2",
  },
]);

const claudeCodeLog = [
  JSON.stringify({ type: "user", sessionId: "s", message: { role: "user", content: "hi" } }),
  JSON.stringify({ type: "assistant", sessionId: "s", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }),
].join("\n");

const pasteText = "User: hi\nAssistant: hello";

describe("detectSource", () => {
  it("detects claude export", () => expect(detectSource(claudeExport)).toBe("claude"));
  it("detects chatgpt export", () => expect(detectSource(chatgptExport)).toBe("chatgpt"));
  it("detects claude code JSONL", () => expect(detectSource(claudeCodeLog)).toBe("claude_code"));
  it("falls back to paste for plain text", () => expect(detectSource(pasteText)).toBe("paste"));
  it("falls back to paste for malformed JSON", () => expect(detectSource("{bad}")).toBe("paste"));
});

describe("parseContent", () => {
  it("auto-dispatches to claude parser", () => {
    const { conversations, issues } = parseContent(claudeExport);
    expect(issues).toEqual([]);
    expect(conversations[0].source).toBe("claude");
  });

  it("auto-dispatches to chatgpt parser", () => {
    const { conversations } = parseContent(chatgptExport);
    expect(conversations[0].source).toBe("chatgpt");
  });

  it("auto-dispatches to claude_code parser", () => {
    const { conversations } = parseContent(claudeCodeLog);
    expect(conversations[0].source).toBe("claude_code");
  });

  it("auto-dispatches to paste parser", () => {
    const { conversations } = parseContent(pasteText);
    expect(conversations[0].source).toBe("manual");
  });

  it("honors explicit source override", () => {
    const { conversations } = parseContent(pasteText, { source: "paste" });
    expect(conversations[0].source).toBe("manual");
  });

  it("returns error issue for JSON parse failure on explicit claude source", () => {
    const { conversations, issues } = parseContent("not json", { source: "claude" });
    expect(conversations).toHaveLength(0);
    expect(issues[0].code).toBe("json_parse_error");
  });
});
