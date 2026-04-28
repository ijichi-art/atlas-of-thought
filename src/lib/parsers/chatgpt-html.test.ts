import { describe, expect, it } from "vitest";
import { parseChatGPTHtml } from "./chatgpt";
import { detectSource, parseContent } from "./index";

const ONE_CONV_FIXTURE_JSON = `[
  {
    "conversation_id": "abc-123",
    "id": "abc-123",
    "title": "Hello",
    "create_time": 1710496608.0,
    "current_node": "node-2",
    "mapping": {
      "node-0": { "id": "node-0", "parent": null, "children": ["node-1"], "message": null },
      "node-1": {
        "id": "node-1",
        "parent": "node-0",
        "children": ["node-2"],
        "message": {
          "id": "node-1",
          "author": { "role": "user" },
          "content": { "content_type": "text", "parts": ["Hi there"] },
          "create_time": 1710496608.0
        }
      },
      "node-2": {
        "id": "node-2",
        "parent": "node-1",
        "children": [],
        "message": {
          "id": "node-2",
          "author": { "role": "assistant" },
          "content": { "content_type": "text", "parts": ["Hello!"] },
          "create_time": 1710496609.0
        }
      }
    }
  }
]`;

const FIXTURE_HTML = `<html>
  <head><title>ChatGPT Data Export</title></head>
  <body>
    <script>
      var jsonData = ${ONE_CONV_FIXTURE_JSON};
    </script>
  </body>
</html>`;

describe("parseChatGPTHtml", () => {
  it("extracts the embedded jsonData and parses as ChatGPT export", () => {
    const out = parseChatGPTHtml(FIXTURE_HTML);
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations[0].title).toBe("Hello");
    expect(out.conversations[0].messages).toHaveLength(2);
  });

  it("emits a clear error when there is no embedded jsonData", () => {
    const out = parseChatGPTHtml("<html><body>no data here</body></html>");
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("no_jsondata");
  });
});

describe("integration: detectSource + parseContent route ChatGPT html correctly", () => {
  it("an HTML file with 'ChatGPT Data Export' title detects as chatgpt, not gemini", () => {
    expect(detectSource(FIXTURE_HTML)).toBe("chatgpt");
  });

  it("parseContent('auto', html) reaches parseChatGPTHtml", () => {
    const out = parseContent(FIXTURE_HTML);
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations[0].title).toBe("Hello");
  });

  it("Google Takeout HTML still routes to gemini", () => {
    const takeoutHtml = `<!DOCTYPE html><html><body>
      <div class="outer-cell">
        <div class="header-cell"><p class="mdl-typography--title">Gemini Apps</p></div>
        <div class="content-cell mdl-typography--body-1">
          Prompted Hi.<br>Apr 1, 2026, 1:00:00 PM JST
        </div>
      </div>
    </body></html>`;
    expect(detectSource(takeoutHtml)).toBe("gemini");
  });
});

describe("export_manifest.json rejection", () => {
  it("emits a friendly error instead of falling through to paste", () => {
    const manifest = JSON.stringify({
      export_files: [{ path: "foo.png", size_bytes: 1234 }],
    });
    const out = parseContent(manifest);
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("manifest_only");
    expect(out.issues[0].message).toContain("manifest");
  });
});
