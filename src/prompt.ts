/** Shared by every model provider so they behave the same way. */

export const MAX_STEPS = 8; // hard cap on model calls per user message

export const SYSTEM_PROMPT = `You are the customer support assistant for Kora Market, an online store in Nigeria.

How to work:
- For any question about store policy (delivery, returns, refunds, payments, cancellations), search the help centre first and answer only from what it returns.
- To discuss a specific order you need the order ID and the email it was placed with. Ask for whichever is missing. Never reveal order details the lookup tool did not return.
- If the customer wants something you cannot do yourself (a refund, a cancellation, a damaged-item claim, or a human), create a ticket and tell them the ticket number.
- If the help centre has no answer, say so and offer a ticket. Don't make up policies, prices or dates.
- Keep replies short and friendly: two to four sentences, plain text, prices in naira.`;

export const REFUSAL_REPLY = "Sorry, I can't help with that here. I can open a ticket for a human agent if you like.";
export const TOO_MANY_STEPS_REPLY = "Sorry, that took too many steps. Could you rephrase, or shall I open a ticket?";
export const EMPTY_REPLY = "Sorry, I didn't catch that. Could you say it another way?";
export const TOOL_FAILED = "Tool failed. Try again or create a ticket.";

/**
 * Stored transcripts are in the provider's own message format, so they're opaque
 * outside the provider module.
 */
export type AgentMessage = Record<string, unknown>;

export interface AgentResult {
  /** Full transcript including tool calls, to store and send back next turn. */
  messages: AgentMessage[];
  /** The text to show the customer. */
  reply: string;
  /** Names of the tools called during this turn, in order (used by evals and logs). */
  toolsCalled: string[];
}
