import { describe, expect, it } from "vitest";
import { parseClaudeExport } from "./claude";

describe("parseClaudeExport", () => {
  it("parses structured content blocks", () => {
    const input = [
      {
        uuid: "c1",
        name: "Demo",
        created_at: "2024-01-01T00:00:00.000Z",
        chat_messages: [
          {
            uuid: "m1",
            sender: "human",
            content: [{ type: "text", text: "hi" }],
            created_at: "2024-01-01T00:00:01.000Z",
          },
          {
            uuid: "m2",
            sender: "assistant",
            content: [
              { type: "text", text: "hello" },
              { type: "tool_use", name: "calc" },
              { type: "text", text: "how can I help?" },
            ],
            created_at: "2024-01-01T00:00:02.000Z",
          },
        ],
      },
    ];

    const { conversations, issues } = parseClaudeExport(input);
    expect(issues).toEqual([]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].source).toBe("claude");
    expect(conversations[0].externalId).toBe("c1");
    expect(conversations[0].messages).toEqual([
      { role: "user", text: "hi", createdAt: new Date("2024-01-01T00:00:01.000Z") },
      {
        role: "assistant",
        text: "hello\n\nhow can I help?",
        createdAt: new Date("2024-01-01T00:00:02.000Z"),
      },
    ]);
  });

  it("falls back to the top-level text field when content is a string", () => {
    const input = [
      {
        uuid: "c2",
        name: "Old format",
        chat_messages: [
          { uuid: "m1", sender: "human", text: "old-style user" },
          { uuid: "m2", sender: "assistant", content: "old-style assistant" },
        ],
      },
    ];

    const { conversations } = parseClaudeExport(input);
    expect(conversations[0].messages.map((m) => m.text)).toEqual([
      "old-style user",
      "old-style assistant",
    ]);
  });

  it("skips messages with unknown senders", () => {
    const input = [
      {
        uuid: "c3",
        name: "With unknown sender",
        chat_messages: [
          { sender: "human", content: [{ type: "text", text: "keep me" }] },
          { sender: "plugin", content: [{ type: "text", text: "drop me" }] },
          { sender: "assistant", content: [{ type: "text", text: "keep me too" }] },
        ],
      },
    ];

    const { conversations } = parseClaudeExport(input);
    expect(conversations[0].messages.map((m) => m.text)).toEqual(["keep me", "keep me too"]);
  });

  it("skips conversations with no text after filtering", () => {
    const input = [
      {
        uuid: "c4",
        name: "All tool-use",
        chat_messages: [
          { sender: "assistant", content: [{ type: "tool_use", name: "calc" }] },
        ],
      },
    ];

    const { conversations, issues } = parseClaudeExport(input);
    expect(conversations).toHaveLength(0);
    expect(issues.find((i) => i.code === "no_renderable_messages")).toBeTruthy();
  });

  it("emits an error for unrecognized top-level input", () => {
    const { conversations, issues } = parseClaudeExport(42);
    expect(conversations).toHaveLength(0);
    expect(issues[0].code).toBe("unrecognized_input");
  });

  it("accepts a single-conversation object", () => {
    const input = {
      uuid: "solo",
      name: "Solo",
      chat_messages: [
        { sender: "human", content: [{ type: "text", text: "a" }] },
        { sender: "assistant", content: [{ type: "text", text: "b" }] },
      ],
    };
    const { conversations } = parseClaudeExport(input);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].externalId).toBe("solo");
  });
});
