import type { Db } from "../db.js";
import { MAX_STEPS, type AgentMessage, type AgentResult } from "../prompt.js";
import { runTool, type ToolOutcome } from "../tools.js";

/**
 * Free test mode: a scripted, rule-based stand-in for the LLM. No API key, no cost.
 *
 * It decides which tool to call with simple pattern matching, but the tools themselves
 * are the real ones, running against the real database. So order lookups, the email
 * ownership check, input validation and ticket creation are all exercised for real;
 * only the "intelligence" is fake. Use it for demos, local development and CI.
 */

type MockMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; name: string; input: unknown; content: string; is_error?: boolean };

const ORDER_ID = /\bKM-\d{4,8}\b/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const DAMAGED = /\b(damaged|broken|torn|cracked|defective|faulty|smashed)\b/i;
const WANTS_HUMAN = /\b(ticket|human|agent|real person|speak to (someone|a person)|complain)\b/i;
const ABOUT_THEIR_ORDERS = /\b(my|every|all|this|that) orders?\b|\borders? for\b|\bwhere is (it|my)\b/i;

export async function runMockAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  const messages: MockMessage[] = [...(history as unknown as MockMessage[]), { role: "user", content: userText }];
  const toolsCalled: string[] = [];

  async function call(name: string, input: unknown): Promise<ToolOutcome> {
    if (toolsCalled.length >= MAX_STEPS) throw new Error("step cap reached");
    toolsCalled.push(name);
    const outcome = await runTool(name, input, db);
    messages.push({ role: "tool", name, input, ...outcome });
    return outcome;
  }

  const reply = await decide(userText, earlierUserText(history), call);
  messages.push({ role: "assistant", content: reply });
  return { messages: messages as unknown as AgentMessage[], reply, toolsCalled };
}

function earlierUserText(history: AgentMessage[]): string {
  return (history as unknown as MockMessage[])
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

async function decide(
  text: string,
  earlier: string,
  call: (name: string, input: unknown) => Promise<ToolOutcome>,
): Promise<string> {
  // The order ID and email can come from this message or an earlier one in the chat.
  const orderId = text.match(ORDER_ID)?.[0] ?? earlier.match(ORDER_ID)?.[0];
  const email = text.match(EMAIL)?.[0] ?? earlier.match(EMAIL)?.[0];

  // 1. Damaged items and requests for a person become tickets.
  if (DAMAGED.test(text) || WANTS_HUMAN.test(text)) {
    if (!email) return "I can pass this to a human agent. What email address should they reply to?";
    const damaged = DAMAGED.test(text) || DAMAGED.test(earlier);
    const outcome = await call("create_ticket", {
      email,
      subject: damaged ? `Damaged item${orderId ? ` (${orderId.toUpperCase()})` : ""}` : "Customer asked for a human agent",
      summary: [earlier, text].filter(Boolean).join("\n").slice(-2000).padEnd(10, "."),
      priority: damaged ? "high" : "normal",
    });
    if (outcome.is_error) return "Sorry, I couldn't open a ticket. Please check your email address and try again.";
    const ticketNo = outcome.content.match(/#(\d+)/)?.[1];
    return `I've opened ticket #${ticketNo} for you. A human agent will reply to ${email} within 24 hours.`;
  }

  // 2. Questions about a specific order need the order ID AND the email it was placed with.
  const freshOrderTurn = ORDER_ID.test(text) || (EMAIL.test(text) && orderId);
  if (freshOrderTurn || ABOUT_THEIR_ORDERS.test(text)) {
    if (!orderId) return "I can check that for you. What's the order ID? It starts with KM-, e.g. KM-10421.";
    if (!email) return `Thanks. To look up ${orderId.toUpperCase()}, what email address did you order with?`;
    const outcome = await call("lookup_order", { order_id: orderId, email });
    if (outcome.is_error) return "That order ID or email doesn't look right. Could you check them?";
    if (!outcome.content.startsWith("{")) {
      return "I couldn't find an order with that ID and email. Please check both, or I can open a ticket for you.";
    }
    return describeOrder(JSON.parse(outcome.content));
  }

  // 3. Everything else is answered from the help centre, or not at all.
  const outcome = await call("search_help_center", { query: text.slice(0, 200).padEnd(2, "?") });
  const article = outcome.is_error ? undefined : outcome.content.match(/^## (.+)\n([\s\S]+?)(?=\n\n## |$)/);
  if (!article) {
    return "I couldn't find anything about that in our help centre, and I don't want to guess. Shall I open a ticket for a human agent?";
  }
  return `From our help centre ("${article[1]}"): ${article[2].trim()}`;
}

interface OrderRow {
  id: string;
  status: string;
  items: { name: string; qty: number }[];
  total_ngn: number;
  eta: string | null;
}

function describeOrder(o: OrderRow): string {
  const items = o.items.map((i) => `${i.name} ×${i.qty}`).join(", ");
  const total = `₦${o.total_ngn.toLocaleString("en-NG")}`;
  const eta = o.eta ? ` Expected delivery: ${String(o.eta).slice(0, 10)}.` : "";
  const status: Record<string, string> = {
    processing: "is being processed and hasn't shipped yet",
    shipped: "has shipped and is on its way",
    delivered: "was delivered",
    cancelled: "was cancelled, and the refund is automatic",
    returned: "was returned",
  };
  return `Order ${o.id} ${status[o.status] ?? `is ${o.status}`} (${o.status}). Items: ${items}. Total ${total}.${o.status === "shipped" ? eta : ""}`;
}
