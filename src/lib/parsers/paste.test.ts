import { describe, expect, it } from "vitest";
import { parsePastedTranscript } from "./paste";

describe("parsePastedTranscript", () => {
  it("splits on User: / Assistant: labels", () => {
    const raw = [
      "User: what's 1+1?",
      "Assistant: 2",
      "User: why?",
      "Assistant: because math.",
    ].join("\n");

    const { conversations, issues } = parsePastedTranscript(raw);
    expect(issues).toEqual([]);
    expect(conversations[0].source).toBe("manual");
    expect(conversations[0].messages).toEqual([
      { role: "user", text: "what's 1+1?" },
      { role: "assistant", text: "2" },
      { role: "user", text: "why?" },
      { role: "assistant", text: "because math." },
    ]);
  });

  it("keeps multi-line message bodies together", () => {
    const raw = [
      "User: here's a question",
      "with multiple lines",
      "",
      "Assistant: and here's an answer",
      "that is also long",
    ].join("\n");

    const { conversations } = parsePastedTranscript(raw);
    expect(conversations[0].messages[0].text).toBe("here's a question\nwith multiple lines");
    expect(conversations[0].messages[1].text).toBe("and here's an answer\nthat is also long");
  });

  it("maps Claude / ChatGPT / Human / You to normalized roles", () => {
    const raw = [
      "Human: one",
      "Claude: two",
      "You: three",
      "ChatGPT: four",
    ].join("\n");

    const { conversations } = parsePastedTranscript(raw);
    expect(conversations[0].messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("strips markdown header and bold decorations around labels", () => {
    const raw = [
      "## User",
      "first line",
      "**Assistant:** structured answer",
    ].join("\n");

    const { conversations } = parsePastedTranscript(raw);
    expect(conversations[0].messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "first line"],
      ["assistant", "structured answer"],
    ]);
  });

  it("warns when no role labels are found and treats everything as one user message", () => {
    const raw = "This is just a random paste with no labels at all.";

    const { conversations, issues } = parsePastedTranscript(raw);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toEqual([{ role: "user", text: raw }]);
    expect(issues.find((i) => i.code === "no_role_labels")).toBeTruthy();
  });

  it("errors on empty input", () => {
    const { conversations, issues } = parsePastedTranscript("   \n\n  ");
    expect(conversations).toHaveLength(0);
    expect(issues[0].code).toBe("empty_input");
  });

  it("uses the first user message as title when no opts.title", () => {
    const raw = "User: this is the expected title\nAssistant: reply";
    const { conversations } = parsePastedTranscript(raw);
    expect(conversations[0].title).toBe("this is the expected title");
  });

  it("honors title override", () => {
    const raw = "User: hi\nAssistant: hi";
    const { conversations } = parsePastedTranscript(raw, { title: "Custom" });
    expect(conversations[0].title).toBe("Custom");
  });
});
