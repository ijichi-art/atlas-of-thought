import { describe, expect, it } from "vitest";
import { parseChatGPTExport } from "./chatgpt";

// Factory helpers — keep fixtures terse so intent stays visible.

function textNode(
  id: string,
  role: "user" | "assistant" | "system" | "tool",
  text: string,
  parent: string | null,
  children: string[] = [],
  opts: { hidden?: boolean; createTime?: number } = {},
) {
  return {
    id,
    parent,
    children,
    message: {
      id,
      author: { role },
      create_time: opts.createTime ?? null,
      content: { content_type: "text", parts: [text] },
      metadata: opts.hidden ? { is_visually_hidden_from_conversation: true } : {},
    },
  };
}

function conversation(
  id: string,
  title: string,
  nodes: ReturnType<typeof textNode>[],
  currentNode: string,
) {
  const mapping: Record<string, (typeof nodes)[number]> = {};
  for (const n of nodes) mapping[n.id] = n;
  return {
    id,
    conversation_id: id,
    title,
    create_time: 1700000000,
    mapping,
    current_node: currentNode,
  };
}

describe("parseChatGPTExport", () => {
  it("extracts linear user/assistant turns in chronological order", () => {
    const export1 = [
      conversation(
        "conv-1",
        "Hello world",
        [
          textNode("root", "system", "Root (should be ignored with no real message)", null, ["u1"]),
          textNode("u1", "user", "ping", "root", ["a1"]),
          textNode("a1", "assistant", "pong", "u1", []),
        ],
        "a1",
      ),
    ];

    const { conversations, issues } = parseChatGPTExport(export1);
    expect(issues).toEqual([]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].source).toBe("chatgpt");
    expect(conversations[0].externalId).toBe("conv-1");
    expect(conversations[0].title).toBe("Hello world");
    expect(conversations[0].messages.map((m) => [m.role, m.text])).toEqual([
      ["system", "Root (should be ignored with no real message)"],
      ["user", "ping"],
      ["assistant", "pong"],
    ]);
  });

  it("walks the current_node path through a branched mapping (ignoring other branches)", () => {
    // Tree:  root → u1 → a1 (old branch) OR u1 → a1b (regenerated branch)
    //                              ↓
    //                            u2 → a2  (selected path ends here)
    const export1 = [
      conversation(
        "conv-2",
        "Branched",
        [
          textNode("root", "system", "", null, ["u1"]),
          textNode("u1", "user", "first", "root", ["a1", "a1b"]),
          textNode("a1", "assistant", "OLD REPLY — should not appear", "u1", []),
          textNode("a1b", "assistant", "regenerated reply", "u1", ["u2"]),
          textNode("u2", "user", "follow-up", "a1b", ["a2"]),
          textNode("a2", "assistant", "final answer", "u2", []),
        ],
        "a2",
      ),
    ];

    const { conversations } = parseChatGPTExport(export1);
    expect(conversations[0].messages.map((m) => m.text)).toEqual([
      "first",
      "regenerated reply",
      "follow-up",
      "final answer",
    ]);
  });

  it("skips visually-hidden system messages (internal prompts)", () => {
    const export1 = [
      conversation(
        "conv-3",
        "With hidden system",
        [
          textNode("root", "system", "", null, ["sys"]),
          textNode("sys", "system", "SECRET SYSTEM PROMPT", "root", ["u1"], { hidden: true }),
          textNode("u1", "user", "visible user msg", "sys", []),
        ],
        "u1",
      ),
    ];

    const { conversations } = parseChatGPTExport(export1);
    expect(conversations[0].messages.map((m) => m.text)).toEqual(["visible user msg"]);
  });

  it("extracts tool/assistant messages and preserves order", () => {
    const export1 = [
      conversation(
        "conv-4",
        "With tool",
        [
          textNode("u1", "user", "run code", null, ["a1"]),
          textNode("a1", "assistant", "ok, running", "u1", ["t1"]),
          textNode("t1", "tool", "1+1=2", "a1", ["a2"]),
          textNode("a2", "assistant", "the answer is 2", "t1", []),
        ],
        "a2",
      ),
    ];

    const { conversations } = parseChatGPTExport(export1);
    expect(conversations[0].messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("skips conversations with no usable text", () => {
    const export1 = [
      conversation(
        "conv-empty",
        "Nothing here",
        [textNode("root", "system", "", null, [])],
        "root",
      ),
    ];

    const { conversations, issues } = parseChatGPTExport(export1);
    expect(conversations).toHaveLength(0);
    expect(issues.find((i) => i.code === "no_renderable_messages")).toBeTruthy();
  });

  it("handles multimodal content parts by dropping non-text parts", () => {
    const export1 = [
      {
        id: "conv-mm",
        conversation_id: "conv-mm",
        title: "With image",
        mapping: {
          u1: {
            id: "u1",
            parent: null,
            children: ["a1"],
            message: {
              id: "u1",
              author: { role: "user" },
              content: {
                content_type: "multimodal_text",
                parts: [
                  "here's what I see:",
                  { content_type: "image_asset_pointer", asset_pointer: "file-xyz" },
                  "what is it?",
                ],
              },
            },
          },
          a1: {
            id: "a1",
            parent: "u1",
            children: [],
            message: {
              id: "a1",
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["a cat"] },
            },
          },
        },
        current_node: "a1",
      },
    ];

    const { conversations } = parseChatGPTExport(export1);
    expect(conversations[0].messages[0].text).toBe("here's what I see:\n\nwhat is it?");
    expect(conversations[0].messages[1].text).toBe("a cat");
  });

  it("converts create_time seconds to Date", () => {
    const { conversations } = parseChatGPTExport([
      conversation(
        "conv-time",
        "Timestamps",
        [
          textNode("u1", "user", "hello", null, ["a1"], { createTime: 1700000000 }),
          textNode("a1", "assistant", "hi", "u1", []),
        ],
        "a1",
      ),
    ]);
    expect(conversations[0].messages[0].createdAt).toEqual(new Date("2023-11-14T22:13:20.000Z"));
  });

  it("accepts a single-conversation object at the top level", () => {
    const single = conversation(
      "conv-solo",
      "Solo",
      [
        textNode("u1", "user", "solo ping", null, ["a1"]),
        textNode("a1", "assistant", "solo pong", "u1", []),
      ],
      "a1",
    );
    const { conversations } = parseChatGPTExport(single);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].externalId).toBe("conv-solo");
  });

  it("emits an error issue for unrecognized input", () => {
    const { conversations, issues } = parseChatGPTExport("definitely not a ChatGPT export");
    expect(conversations).toHaveLength(0);
    expect(issues[0].level).toBe("error");
    expect(issues[0].code).toBe("unrecognized_input");
  });

  it("survives cycles in malformed mappings without hanging", () => {
    // Cycle: u1 → u2 → u1 (a corrupt export). Should not infinite-loop.
    const export1 = [
      {
        id: "conv-cycle",
        conversation_id: "conv-cycle",
        title: "Cycle",
        mapping: {
          u1: {
            id: "u1",
            parent: "u2",
            children: ["u2"],
            message: { id: "u1", author: { role: "user" }, content: { content_type: "text", parts: ["a"] } },
          },
          u2: {
            id: "u2",
            parent: "u1",
            children: ["u1"],
            message: { id: "u2", author: { role: "assistant" }, content: { content_type: "text", parts: ["b"] } },
          },
        },
        current_node: "u2",
      },
    ];

    const { conversations } = parseChatGPTExport(export1);
    // Path collection stops at the cycle; we just ensure it returns *something*
    // finite rather than hanging.
    expect(conversations[0].messages.length).toBeGreaterThan(0);
    expect(conversations[0].messages.length).toBeLessThan(10);
  });
});
