import { describe, expect, it } from "vitest";
import {
  buildReclaimTaskTitle,
  scheduleTypeFromCategory,
  stripReclaimSyntaxFromBaseTitle,
} from "./reclaim-task-syntax";

describe("stripReclaimSyntaxFromBaseTitle", () => {
  it("removes legacy upnext prefix", () => {
    expect(stripReclaimSyntaxFromBaseTitle("upnext Nina Pfau: Steuerautomation klären")).toBe(
      "Nina Pfau: Steuerautomation klären"
    );
  });

  it("removes trailing reclaim paren syntax", () => {
    expect(stripReclaimSyntaxFromBaseTitle("Call mom (type personal upnext)")).toBe("Call mom");
  });
});

describe("buildReclaimTaskTitle", () => {
  it("builds full Google Tasks / Reclaim syntax", () => {
    const title = buildReclaimTaskTitle({
      title: "Review proposal",
      due_date: "2026-06-12",
      not_before: "2026-06-10",
      priority: 5,
      estimated_time_minutes: 90,
      mark_as_next: true,
      schedule_type: "work",
      no_split: true,
    });
    expect(title).toBe(
      "Review proposal (type work due 2026-06-12 not before 2026-06-10 priority:critical upnext duration:1h30m nosplit)"
    );
  });

  it("supports natural-language due and not-before phrases", () => {
    const title = buildReclaimTaskTitle({
      title: "Plan sprint",
      due_phrase: "next monday",
      not_before_phrase: "tomorrow",
      schedule_type: "personal",
    });
    expect(title).toBe("Plan sprint (type personal due next monday not before tomorrow)");
  });

  it("maps category to schedule type when type is unset", () => {
    const title = buildReclaimTaskTitle({
      title: "Call mom",
      category: "Privat",
      mark_as_next: true,
    });
    expect(title).toBe("Call mom (type personal upnext)");
  });

  it("returns plain title when no syntax tokens apply", () => {
    expect(buildReclaimTaskTitle({ title: "Simple task" })).toBe("Simple task");
  });

  it("migrates legacy upnext prefix into parenthetical syntax", () => {
    const title = buildReclaimTaskTitle({
      title: "upnext Nina Pfau Universumpost: Steuerautomation klären",
      due_date: "2026-06-10",
      mark_as_next: true,
    });
    expect(title).toBe(
      "Nina Pfau Universumpost: Steuerautomation klären (due 2026-06-10 upnext)"
    );
  });
});

describe("scheduleTypeFromCategory", () => {
  it("detects work and personal categories", () => {
    expect(scheduleTypeFromCategory("Arbeit")).toBe("work");
    expect(scheduleTypeFromCategory("Privat")).toBe("personal");
    expect(scheduleTypeFromCategory("Follow-up")).toBeNull();
  });
});
