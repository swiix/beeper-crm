import { describe, expect, it } from "vitest";
import { durationHoursToChunks, mapCrmPriorityToReclaim } from "@/lib/reclaim";

describe("reclaim helpers", () => {
  it("maps CRM priority to Reclaim P levels", () => {
    expect(mapCrmPriorityToReclaim(5)).toBe("P1");
    expect(mapCrmPriorityToReclaim(4)).toBe("P2");
    expect(mapCrmPriorityToReclaim(3)).toBe("P3");
    expect(mapCrmPriorityToReclaim(1)).toBe("P4");
    expect(mapCrmPriorityToReclaim(null)).toBeNull();
  });

  it("converts duration hours to 15-min chunks", () => {
    expect(durationHoursToChunks(0.25)).toBe(1);
    expect(durationHoursToChunks(1)).toBe(4);
    expect(durationHoursToChunks(0)).toBe(1);
  });
});
