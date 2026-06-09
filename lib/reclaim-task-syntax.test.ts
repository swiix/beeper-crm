import { describe, expect, it } from "vitest";
import { buildReclaimTaskTitle, scheduleTypeFromCategory } from "./reclaim-task-syntax";

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
});

describe("scheduleTypeFromCategory", () => {
  it("detects work and personal categories", () => {
    expect(scheduleTypeFromCategory("Arbeit")).toBe("work");
    expect(scheduleTypeFromCategory("Privat")).toBe("personal");
    expect(scheduleTypeFromCategory("Follow-up")).toBeNull();
  });
});
