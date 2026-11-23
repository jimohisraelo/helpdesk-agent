import OpenAI from "openai";
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

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";

// Same tools as the Claude provider, converted to OpenAI's function-tool format.
export const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionFunctionTool[] = TOOL_DEFINITIONS.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema as Record<string, unknown>,
    strict: true,
  },
}));

let client: OpenAI | undefined;
const getClient = () => (client ??= new OpenAI());

/**
 * One customer turn with OpenAI: call the model, run any tools it asks for,
 * repeat until it answers. The system prompt is added per request, not stored.
 */
export async function runOpenAIAgent(history: AgentMessage[], userText: string, db: Db): Promise<AgentResult> {
  const messages: Message[] = [...(history as unknown as Message[]), { role: "user", content: userText }];
  const toolsCalled: string[] = [];
  const done = (reply: string): AgentResult => ({ messages: messages as unknown as AgentMessage[], reply, toolsCalled });

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await getClient().chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools: OPENAI_TOOLS,
      max_completion_tokens: 4000,
    });

    const choice = response.choices[0];
    const msg = choice.message;
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    if (!msg.tool_calls?.length) delete (messages.at(-1) as { tool_calls?: unknown }).tool_calls;

    if (msg.refusal) return done(REFUSAL_REPLY);

    const toolCalls = (msg.tool_calls ?? []).filter(
      (c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === "function",
    );
    if (toolCalls.length === 0) return done(msg.content?.trim() || EMPTY_REPLY);

    // Each tool call gets its own "tool" message, matched by tool_call_id.
    const results = await Promise.all(
      toolCalls.map(async (call): Promise<Message> => {
        toolsCalled.push(call.function.name);
        let content: string;
        try {
          const input = JSON.parse(call.function.arguments || "{}");
          const outcome = await runTool(call.function.name, input, db);
          content = outcome.is_error ? `Error: ${outcome.content}` : outcome.content;
        } catch (err) {
          console.error(`tool ${call.function.name} failed`, err);
          content = TOOL_FAILED;
        }
        return { role: "tool", tool_call_id: call.id, content };
      }),
    );
    messages.push(...results);
  }

  return done(TOO_MANY_STEPS_REPLY);
}
