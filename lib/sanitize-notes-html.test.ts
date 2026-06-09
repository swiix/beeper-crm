import { describe, expect, it } from "vitest";
import { sanitizeNotesHtml } from "./sanitize-notes-html";

describe("sanitizeNotesHtml", () => {
  it("linkifies plain URLs", () => {
    const html = sanitizeNotesHtml("Schau https://example.com/video an.");
    expect(html).toContain('<a href="https://example.com/video"');
    expect(html).not.toContain("&lt;a");
  });

  it("renders safe anchor tags from AI output", () => {
    const raw =
      'todo: das anschauen <a href="https://www.youtube.com/watch?v=abc" rel="noopener noreferrer" target="_blank">https://www.youtube.com/watch?v=abc</a>.';
    const html = sanitizeNotesHtml(raw);
    expect(html).toContain('<a href="https://www.youtube.com/watch?v=abc"');
    expect(html).toContain("https://www.youtube.com/watch?v=abc</a>");
    expect(html).not.toContain("<script");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("strips unsafe tags but keeps text", () => {
    const html = sanitizeNotesHtml('Hello <script>alert(1)</script> world');
    expect(html).toBe("Hello  world");
  });

  it("rejects javascript hrefs", () => {
    const html = sanitizeNotesHtml('<a href="javascript:alert(1)">click</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });
});
