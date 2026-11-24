import { describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db.js";
import { runMockAgent } from "../src/providers/mock.js";

function fakeDb(rows: unknown[] = []): Db & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) } as never;
}

describe("mock (free test mode) model", () => {
  it("answers policy questions from the help centre", async () => {
    const db = fakeDb([{ title: "Returns and refunds", body: "Return within 7 days." }]);
    const r = await runMockAgent([], "What's your return policy?", db);
    expect(r.toolsCalled).toEqual(["search_help_center"]);
    expect(r.reply).toContain("7 days");
  });

  it("says so instead of guessing when the help centre has nothing", async () => {
    const r = await runMockAgent([], "Do you sell gift cards?", fakeDb([]));
    expect(r.reply).toMatch(/couldn't find/);
  });

  it("asks for the email before looking up an order, then remembers the order ID", async () => {
    const first = await runMockAgent([], "Where is my order KM-10421?", fakeDb());
    expect(first.toolsCalled).toEqual([]);
    expect(first.reply).toMatch(/email/);

    const db = fakeDb([
      { id: "KM-10421", status: "shipped", items: [{ name: "Earbuds", qty: 1 }], total_ngn: 47000, eta: "2026-11-26" },
    ]);
    const second = await runMockAgent(first.messages, "ada@example.com", db);
    expect(second.toolsCalled).toEqual(["lookup_order"]);
    expect(db.query.mock.calls[0][1]).toEqual(["KM-10421", "ada@example.com"]);
    expect(second.reply).toContain("shipped");
  });

  it("does not reveal anything when the email doesn't own the order", async () => {
    const r = await runMockAgent([], "What's in order KM-10430? My email is ada@example.com", fakeDb([]));
    expect(r.reply).toMatch(/couldn't find an order/);
  });

  it("opens a high-priority ticket for a damaged item", async () => {
    const db = fakeDb([{ id: 7 }]);
    const r = await runMockAgent([], "Order KM-10422 arrived damaged. Email ada@example.com", db);
    expect(r.toolsCalled).toEqual(["create_ticket"]);
    expect(db.query.mock.calls[0][1]?.[3]).toBe("high");
    expect(r.reply).toContain("#7");
  });

  it("asks for an email before opening a ticket", async () => {
    const r = await runMockAgent([], "I want to speak to a human", fakeDb());
    expect(r.toolsCalled).toEqual([]);
    expect(r.reply).toMatch(/email/);
  });
});
