import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Db } from "./db.js";

/**
 * Tool definitions sent to Claude, plus the code that runs them.
 *
 * Rule: the model is never trusted for authorization. Every check
 * (e.g. "does this email own this order?") happens here, in code.
 */

export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_help_center",
    description:
      "Search Kora Market's help-centre articles (delivery, returns, refunds, payments, cancellations, damaged items). " +
      "Use this before answering any question about store policy.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A few keywords, e.g. 'refund time' or 'change address'" },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "lookup_order",
    description:
      "Look up an order's status, items, total and delivery estimate. Needs BOTH the order ID (starts with KM-) " +
      "and the email the customer ordered with. Ask the customer for whichever is missing.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "Order ID, e.g. KM-10421" },
        email: { type: "string", description: "Email address the order was placed with" },
      },
      required: ["order_id", "email"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ticket",
    description:
      "Hand the issue to a human agent. Use when the customer asks for a person, reports a damaged item, " +
      "wants a cancellation or refund processed, or when you cannot resolve the issue with the other tools.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Customer's email for the reply" },
        subject: { type: "string", description: "One-line subject" },
        summary: { type: "string", description: "What happened and what the customer wants, including any order ID" },
        priority: { type: "string", enum: ["low", "normal", "high"] },
      },
      required: ["email", "subject", "summary", "priority"],
      additionalProperties: false,
    },
  },
];

// Zod mirrors of the schemas above, with the length limits the API schema doesn't carry.
const SearchInput = z.object({ query: z.string().trim().min(2).max(200) });
const LookupInput = z.object({
  order_id: z.string().trim().toUpperCase().regex(/^KM-\d{4,8}$/, "Order IDs look like KM-10421"),
  email: z.string().trim().toLowerCase().email().max(254),
});
const TicketInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  subject: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(2000),
  priority: z.enum(["low", "normal", "high"]),
});

export interface ToolOutcome {
  content: string;
  is_error?: boolean;
}

export async function runTool(name: string, rawInput: unknown, db: Db): Promise<ToolOutcome> {
  switch (name) {
    case "search_help_center":
      return withInput(SearchInput, rawInput, (input) => searchHelpCenter(db, input.query));
    case "lookup_order":
      return withInput(LookupInput, rawInput, (input) => lookupOrder(db, input.order_id, input.email));
    case "create_ticket":
      return withInput(TicketInput, rawInput, (input) => createTicket(db, input));
    default:
      return { content: `Unknown tool: ${name}`, is_error: true };
  }
}

async function withInput<S extends z.ZodTypeAny>(
  schema: S,
  rawInput: unknown,
  fn: (input: z.infer<S>) => Promise<ToolOutcome>,
): Promise<ToolOutcome> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return { content: `Invalid input: ${problems}`, is_error: true };
  }
  return fn(parsed.data);
}

/**
 * Turns "refund time?" into "refund or time", so an article matches if it has ANY
 * keyword (ranking puts the best matches first). Punctuation is stripped so the
 * model can't send search operators.
 */
export function toSearchQuery(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.slice(0, 12).join(" or ");
}

export async function searchHelpCenter(db: Db, rawQuery: string): Promise<ToolOutcome> {
  const query = toSearchQuery(rawQuery);
  if (!query) return { content: "Search with a few keywords.", is_error: true };
  const { rows } = await db.query<{ title: string; body: string }>(
    `SELECT title, body
       FROM help_articles
      WHERE search @@ websearch_to_tsquery('english', $1)
      ORDER BY ts_rank(search, websearch_to_tsquery('english', $1)) DESC
      LIMIT 3`,
    [query],
  );
  if (rows.length === 0) {
    return { content: "No matching help articles. Do not guess the policy; offer to create a ticket instead." };
  }
  return { content: rows.map((r) => `## ${r.title}\n${r.body}`).join("\n\n") };
}

export async function lookupOrder(db: Db, orderId: string, email: string): Promise<ToolOutcome> {
  // The email check lives in the SQL, so an order is only returned to its owner.
  const { rows } = await db.query<{
    id: string;
    status: string;
    items: unknown;
    total_ngn: number;
    eta: string | null;
    created_at: string;
  }>(
    `SELECT o.id, o.status, o.items, o.total_ngn, o.eta, o.created_at
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1 AND lower(c.email) = $2`,
    [orderId, email],
  );
  if (rows.length === 0) {
    // Same message whether the order doesn't exist or belongs to someone else,
    // so the tool can't be used to discover other people's order IDs.
    return { content: "No order found with that order ID and email combination." };
  }
  return { content: JSON.stringify(rows[0]) };
}

export async function createTicket(db: Db, input: z.infer<typeof TicketInput>): Promise<ToolOutcome> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO tickets (email, subject, summary, priority) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.email, input.subject, input.summary, input.priority],
  );
  return { content: `Ticket #${rows[0].id} created. A human agent will reply to ${input.email} within 24 hours.` };
}
