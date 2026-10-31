import { afterEach, describe, expect, it, vi } from "vitest";
import { ALWAYS_APPROVED, autonomyFor, dispositionFor, parseAutonomy, type OperationType } from "./policy";

const ops: OperationType[] = ["stage_update", "owner_assign", "note_create", "task_create", "company_merge"];

describe("dispositionFor", () => {
  it("never lets visible or destructive changes skip the gate", () => {
    for (const op of ALWAYS_APPROVED) {
      expect(dispositionFor(op, "automate")).toBe("needs_approval");
      expect(dispositionFor(op, "assist")).toBe("needs_approval");
    }
    expect([...ALWAYS_APPROVED].sort()).toEqual(["company_merge", "owner_assign", "stage_update"]);
  });

  it("automate writes additive internal records directly; assist gates them; audit gates nothing and writes nothing", () => {
    expect(dispositionFor("note_create", "automate")).toBe("direct");
    expect(dispositionFor("task_create", "automate")).toBe("direct");
    expect(dispositionFor("note_create", "assist")).toBe("needs_approval");
    for (const op of ops) expect(dispositionFor(op, "audit")).toBe("log_only");
  });
});

describe("parseAutonomy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to automate, with the visible-change rule above still in force", () => {
    expect(parseAutonomy(undefined)).toEqual({ default: "automate", tasks: {} });
    expect(parseAutonomy("")).toEqual({ default: "automate", tasks: {} });
  });

  it("reads a default level and per-task overrides", () => {
    const c = parseAutonomy("assist, dedupe=audit , email_notes=automate");
    expect(c.default).toBe("assist");
    expect(autonomyFor(c, "dedupe")).toBe("audit");
    expect(autonomyFor(c, "email_notes")).toBe("automate");
    expect(autonomyFor(c, "stage_sync")).toBe("assist");
  });

  it("ignores (and logs) unknown words instead of loosening anything", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = parseAutonomy("yolo,dedupe=full,nonsense=audit,stage_sync=assist");
    expect(c).toEqual({ default: "automate", tasks: { stage_sync: "assist" } });
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
