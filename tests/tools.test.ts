import { describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db.js";
import { runTool, toSearchQuery } from "../src/tools.js";

describe("toSearchQuery", () => {
  it("ORs keywords and strips search operators", () => {
    expect(toSearchQuery('How long for a "refund" -time?')).toBe("how or long or for or a or refund or time");
  });
});

function fakeDb(rows: unknown[] = []): Db & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) } as never;
}

describe("lookup_order", () => {
  it("checks the email inside the query and normalises inputs", async () => {
    const db = fakeDb([{ id: "KM-10421", status: "shipped" }]);
    const out = await runTool("lookup_order", { order_id: " km-10421 ", email: "Ada@Example.com" }, db);

    expect(out.is_error).toBeUndefined();
    expect(db.query).toHaveBeenCalledOnce();
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/lower\(c\.email\) = \$2/);
    expect(params).toEqual(["KM-10421", "ada@example.com"]);
  });

  it("gives the same answer for a wrong email as for a missing order", async () => {
    const out = await runTool("lookup_order", { order_id: "KM-10421", email: "someone@else.com" }, fakeDb([]));
    expect(out.content).toBe("No order found with that order ID and email combination.");
  });

  it("rejects malformed input without touching the database", async () => {
    const db = fakeDb();
    const out = await runTool("lookup_order", { order_id: "1; DROP TABLE orders", email: "nope" }, db);
    expect(out.is_error).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe("runTool", () => {
  it("returns an error result for unknown tools", async () => {
    const out = await runTool("delete_everything", {}, fakeDb());
    expect(out).toEqual({ content: "Unknown tool: delete_everything", is_error: true });
  });

  it("tells the model not to guess when search finds nothing", async () => {
    const out = await runTool("search_help_center", { query: "crypto payments" }, fakeDb([]));
    expect(out.content).toMatch(/Do not guess/);
  });
});
