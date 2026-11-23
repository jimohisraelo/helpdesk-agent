import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../src/db.js";

// Fake OpenAI client: each test queues the responses the "model" will give.
const create = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { pickProvider } = await import("../src/agent.js");
const { OPENAI_TOOLS, runOpenAIAgent } = await import("../src/providers/openai.js");

function fakeDb(rows: unknown[] = []): Db & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) } as never;
}

const reply = (message: Record<string, unknown>) => ({ choices: [{ message: { content: null, refusal: null, ...message } }] });

describe("pickProvider", () => {
  it("uses LLM_PROVIDER when set", () => {
    expect(pickProvider({ LLM_PROVIDER: "anthropic", OPENAI_API_KEY: "x" })).toBe("anthropic");
    expect(pickProvider({ LLM_PROVIDER: "OpenAI" })).toBe("openai");
  });

  it("falls back to whichever key is present", () => {
    expect(pickProvider({ OPENAI_API_KEY: "x" })).toBe("openai");
    expect(pickProvider({})).toBe("anthropic");
  });

  it("rejects an unknown provider", () => {
    expect(() => pickProvider({ LLM_PROVIDER: "llama" })).toThrow(/LLM_PROVIDER/);
  });
});

describe("OpenAI provider", () => {
  beforeEach(() => create.mockReset());

  it("exposes the same three tools as strict function tools", () => {
    expect(OPENAI_TOOLS.map((t) => t.function.name)).toEqual(["search_help_center", "lookup_order", "create_ticket"]);
    expect(OPENAI_TOOLS.every((t) => t.function.strict)).toBe(true);
  });

  it("runs a tool call, sends the result back, and returns the final answer", async () => {
    create
      .mockResolvedValueOnce(
        reply({
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "search_help_center", arguments: '{"query":"returns"}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(reply({ content: "You can return items within 7 days." }));

    const db = fakeDb([{ title: "Returns and refunds", body: "7 days." }]);
    const result = await runOpenAIAgent([], "What's your return policy?", db);

    expect(result.reply).toBe("You can return items within 7 days.");
    expect(result.toolsCalled).toEqual(["search_help_center"]);
    // Second request carries the system prompt, the tool call and its result.
    const second = create.mock.calls[1][0];
    expect(second.messages[0].role).toBe("system");
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
    // The stored transcript never includes the system prompt.
    expect(result.messages.some((m) => m.role === "system")).toBe(false);
  });

  it("reports bad tool arguments to the model instead of crashing", async () => {
    create
      .mockResolvedValueOnce(
        reply({
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "lookup_order", arguments: '{"order_id":"123","email":"nope"}' } },
          ],
        }),
      )
      .mockResolvedValueOnce(reply({ content: "Could you check the order ID?" }));

    const db = fakeDb();
    await runOpenAIAgent([], "Where is order 123?", db);

    expect(db.query).not.toHaveBeenCalled();
    const toolMessage = create.mock.calls[1][0].messages.at(-1);
    expect(toolMessage.content).toMatch(/^Error: Invalid input/);
  });

  it("returns the refusal message when the model refuses", async () => {
    create.mockResolvedValueOnce(reply({ refusal: "I can't help with that." }));
    const result = await runOpenAIAgent([], "something bad", fakeDb());
    expect(result.reply).toMatch(/open a ticket/);
  });
});
