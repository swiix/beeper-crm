import { describe, expect, it } from "vitest";
import { applyGoogleNextTitle } from "./todo-sync-next";

describe("applyGoogleNextTitle", () => {
  it("prefixes title when markAsNext is true", () => {
    expect(applyGoogleNextTitle("Call client", true)).toBe("upnext Call client");
  });

  it("does not double-prefix", () => {
    expect(applyGoogleNextTitle("upnext Call client", true)).toBe("upnext Call client");
  });

  it("leaves title unchanged when markAsNext is false", () => {
    expect(applyGoogleNextTitle("Call client", false)).toBe("Call client");
  });
});
