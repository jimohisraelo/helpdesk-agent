import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Db } from "./db.js";
import type { AgentMessage, AgentResult } from "./prompt.js";
import { runClaudeAgent } from "./providers/claude.js";
import { runMockAgent } from "./providers/mock.js";
import { runOpenAIAgent } from "./providers/openai.js";

export type { AgentMessage, AgentResult } from "./prompt.js";

export const PROVIDERS = ["openai", "anthropic", "mock"] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * LLM_PROVIDER wins. Otherwise use whichever API key is set (OpenAI first),
 * and with no key at all fall back to the free scripted "mock" model.
 */
export function pickProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const chosen = env.LLM_PROVIDER?.trim().toLowerCase();
  if (chosen) {
    if ((PROVIDERS as readonly string[]).includes(chosen)) return chosen as Provider;
    throw new Error(`LLM_PROVIDER must be one of ${PROVIDERS.join(", ")}; got "${chosen}"`);
  }
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

export const PROVIDER: Provider = pickProvider();

const RUNNERS: Record<Provider, typeof runMockAgent> = {
  openai: runOpenAIAgent,
  anthropic: runClaudeAgent,
  mock: runMockAgent,
};

export function runAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  return RUNNERS[PROVIDER](history, userText, db);
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
