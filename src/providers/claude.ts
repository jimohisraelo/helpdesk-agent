import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../db.js";
import {
  EMPTY_REPLY,
  MAX_STEPS,
  REFUSAL_REPLY,
  SYSTEM_PROMPT,
  TOO_MANY_STEPS_REPLY,
  TOOL_FAILED,
  type AgentMessage,
  type AgentResult,
} from "../prompt.js";
import { TOOL_DEFINITIONS, runTool } from "../tools.js";

type Message = Anthropic.Beta.BetaMessageParam;

const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | undefined;
const getClient = () => (client ??= new Anthropic());

/**
 * One customer turn with Claude: call the model, run any tools it asks for,
 * repeat until it answers. The transcript is append-only.
 */
export async function runClaudeAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  const messages: Message[] = [...(history as unknown as Message[]), { role: "user", content: userText }];
  const toolsCalled: string[] = [];
  const done = (reply: string): AgentResult => ({ messages: messages as unknown as AgentMessage[], reply, toolsCalled });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await getClient().beta.messages.create({
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

    if (response.stop_reason === "refusal") return done(REFUSAL_REPLY);

    const toolCalls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || toolCalls.length === 0) {
      return done(textOf(response.content));
    }

    // Run every tool call from this step, then return all results in ONE user message.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(
      toolCalls.map(async (call) => {
        toolsCalled.push(call.name);
        try {
          const outcome = await runTool(call.name, call.input, db);
          return { type: "tool_result" as const, tool_use_id: call.id, ...outcome };
        } catch (err) {
          console.error(`tool ${call.name} failed`, err);
          return { type: "tool_result" as const, tool_use_id: call.id, content: TOOL_FAILED, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  return done(TOO_MANY_STEPS_REPLY);
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  const text = content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || EMPTY_REPLY;
}
