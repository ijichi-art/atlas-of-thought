import { describe, expect, it } from "vitest";
import { parseGeminiHtml } from "./gemini";

// Mini fixtures modeled on real Google Takeout output. Real exports may
// vary; these tests cover the structures we've observed.

const MINIMAL_FIXTURE = `<!DOCTYPE html>
<html>
<head><title>My Activity</title></head>
<body>
<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp">
  <div class="mdl-grid">
    <div class="header-cell mdl-cell mdl-cell--12-col">
      <p class="mdl-typography--title">Gemini Apps</p>
    </div>
    <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
      Prompted Write a haiku about a cat.<br>
      <a href="https://gemini.google.com/abc">Open in Gemini</a><br>
      Apr 12, 2026, 10:53:24 AM JST
    </div>
    <div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption">
      Products:<br>&emsp;Gemini Apps
    </div>
  </div>
</div>

<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp">
  <div class="mdl-grid">
    <div class="header-cell mdl-cell mdl-cell--12-col">
      <p class="mdl-typography--title">Gemini Apps</p>
    </div>
    <div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">
      Prompted Explain TCP slow start in two sentences.<br>
      <a href="https://gemini.google.com/def">Open in Gemini</a><br>
      Apr 13, 2026, 9:01:00 AM JST
    </div>
  </div>
</div>
</body>
</html>`;

describe("parseGeminiHtml", () => {
  it("extracts each Gemini activity as its own conversation", () => {
    const out = parseGeminiHtml(MINIMAL_FIXTURE);
    expect(out.conversations).toHaveLength(2);
    expect(out.issues).toHaveLength(0);
  });

  it("preserves the prompt text and strips the trailing date line", () => {
    const out = parseGeminiHtml(MINIMAL_FIXTURE);
    expect(out.conversations[0].messages[0].text).toBe("Write a haiku about a cat.");
    expect(out.conversations[1].messages[0].text).toBe(
      "Explain TCP slow start in two sentences.",
    );
  });

  it("extracts the timestamp into createdAt", () => {
    const out = parseGeminiHtml(MINIMAL_FIXTURE);
    const d = out.conversations[0].messages[0].createdAt;
    expect(d).toBeInstanceOf(Date);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(3); // April = 3
  });

  it("titles each conversation from the prompt", () => {
    const out = parseGeminiHtml(MINIMAL_FIXTURE);
    expect(out.conversations[0].title).toContain("haiku");
  });

  it("rejects HTML that contains no activity blocks", () => {
    const out = parseGeminiHtml("<html><body><p>hello</p></body></html>");
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("no_outer_cells");
  });

  it("warns when activity blocks exist but none are Gemini", () => {
    const otherProduct = MINIMAL_FIXTURE.replace(/Gemini Apps/g, "YouTube");
    const out = parseGeminiHtml(otherProduct);
    expect(out.conversations).toHaveLength(0);
    expect(out.issues[0].code).toBe("no_gemini_activities");
  });

  it("decodes HTML entities in the prompt", () => {
    const html =
      MINIMAL_FIXTURE.replace(
        "Write a haiku about a cat.",
        "What&#39;s &quot;O(n)&quot; &amp; why does it matter?",
      );
    const out = parseGeminiHtml(html);
    expect(out.conversations[0].messages[0].text).toBe(
      'What\'s "O(n)" & why does it matter?',
    );
  });

  it("decodes each entity only once", () => {
    const html = MINIMAL_FIXTURE.replace(
      "Write a haiku about a cat.",
      "Explain &amp;lt;script&amp;gt; safely.",
    );
    const out = parseGeminiHtml(html);
    expect(out.conversations[0].messages[0].text).toBe(
      "Explain &lt;script&gt; safely.",
    );
  });

  it("captures an assistant response when a second body cell is present", () => {
    const withResponse = `<!DOCTYPE html>
<div class="outer-cell">
  <div class="header-cell"><p class="mdl-typography--title">Gemini Apps</p></div>
  <div class="content-cell mdl-typography--body-1">
    Prompted Hi there.<br>Apr 1, 2026, 1:00:00 PM JST
  </div>
  <div class="content-cell mdl-typography--body-1">
    Hello! How can I help today?
  </div>
</div>`;
    const out = parseGeminiHtml(withResponse);
    expect(out.conversations).toHaveLength(1);
    expect(out.conversations[0].messages).toHaveLength(2);
    expect(out.conversations[0].messages[1].role).toBe("assistant");
    expect(out.conversations[0].messages[1].text).toContain("How can I help");
  });

  it("produces stable externalIds for dedupe on re-import", () => {
    const a = parseGeminiHtml(MINIMAL_FIXTURE);
    const b = parseGeminiHtml(MINIMAL_FIXTURE);
    expect(a.conversations[0].externalId).toBe(b.conversations[0].externalId);
    expect(a.conversations[0].externalId).not.toBe(a.conversations[1].externalId);
  });
});
