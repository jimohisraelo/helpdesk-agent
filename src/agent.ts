import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "./db.js";
import { TOOL_DEFINITIONS, runTool } from "./tools.js";

export type AgentMessage = Anthropic.Beta.BetaMessageParam;

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const MAX_STEPS = 8; // hard cap on model calls per user message

const SYSTEM_PROMPT = `You are the customer support assistant for Kora Market, an online store in Nigeria.

How to work:
- For any question about store policy (delivery, returns, refunds, payments, cancellations), search the help centre first and answer only from what it returns.
- To discuss a specific order you need the order ID and the email it was placed with. Ask for whichever is missing. Never reveal order details the lookup tool did not return.
- If the customer wants something you cannot do yourself (a refund, a cancellation, a damaged-item claim, or a human), create a ticket and tell them the ticket number.
- If the help centre has no answer, say so and offer a ticket. Don't make up policies, prices or dates.
- Keep replies short and friendly: two to four sentences, plain text, prices in naira.`;

const client = new Anthropic();

export interface AgentResult {
  /** Full transcript including tool calls, to store and send back next turn. */
  messages: AgentMessage[];
  /** The text to show the customer. */
  reply: string;
}

/**
 * One customer turn: call Claude, run any tools it asks for, repeat until it answers.
 * The transcript is append-only, so earlier turns are always sent back unchanged.
 */
export async function runAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  const messages: AgentMessage[] = [...history, { role: "user", content: userText }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
      output_config: { effort: "medium" },
      cache_control: { type: "ephemeral" },
      // If a safety classifier declines, retry on a fallback model chosen by the API.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return { messages, reply: "Sorry, I can't help with that here. I can open a ticket for a human agent if you like." };
    }

    const toolCalls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || toolCalls.length === 0) {
      return { messages, reply: textOf(response.content) };
    }

    // Run every tool call from this step, then return all results in ONE user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolCalls.map(async (call) => {
        try {
          const outcome = await runTool(call.name, call.input, db);
          return { type: "tool_result" as const, tool_use_id: call.id, ...outcome };
        } catch (err) {
          console.error(`tool ${call.name} failed`, err);
          return { type: "tool_result" as const, tool_use_id: call.id, content: "Tool failed. Try again or create a ticket.", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return { messages, reply: "Sorry, that took too many steps. Could you rephrase, or shall I open a ticket?" };
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || "Sorry, I didn't catch that. Could you say it another way?";
}
