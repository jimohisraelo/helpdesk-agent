import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Db } from "./db.js";
import type { AgentMessage, AgentResult } from "./prompt.js";
import { runClaudeAgent } from "./providers/claude.js";
import { runOpenAIAgent } from "./providers/openai.js";

export type { AgentMessage, AgentResult } from "./prompt.js";

export type Provider = "openai" | "anthropic";

/** LLM_PROVIDER wins; otherwise use whichever API key is set (OpenAI first). */
export function pickProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const chosen = env.LLM_PROVIDER?.trim().toLowerCase();
  if (chosen === "openai" || chosen === "anthropic") return chosen;
  if (chosen) throw new Error(`LLM_PROVIDER must be "openai" or "anthropic", got "${chosen}"`);
  return env.OPENAI_API_KEY ? "openai" : "anthropic";
}

export const PROVIDER: Provider = pickProvider();

export function runAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  return PROVIDER === "openai" ? runOpenAIAgent(history, userText, db) : runClaudeAgent(history, userText, db);
}

/** Maps either SDK's errors to an HTTP status and a customer-safe message. */
export function describeModelError(err: unknown): { status: number; message: string } | undefined {
  if (err instanceof Anthropic.RateLimitError || err instanceof OpenAI.RateLimitError) {
    return { status: 503, message: "The assistant is busy. Try again in a minute." };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof OpenAI.AuthenticationError) {
    console.error(`${PROVIDER} API key is missing or invalid`);
    return { status: 500, message: "The assistant isn't configured yet." };
  }
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) {
    console.error(`${PROVIDER} API error ${err.status}`, err.message);
    return { status: 502, message: "The assistant had a problem. Try again." };
  }
  return undefined;
}
