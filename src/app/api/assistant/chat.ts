// The Claude tool loop (Requirements 3.3, 4.4).
//
// `runChat()` drives the conversation that turns a clinician's question into a
// model reply grounded in the engine's assessment. The flow, from design.md
// ("Claude loop"):
//
//   1. EVERY call uses `tool_choice: { type: "auto" }`. The live check (task 7.4)
//      showed `claude-sonnet-5-5` and `claude-opus-5-5` reject a forced
//      `tool_choice` (`type: "tool"` or `"any"`) with HTTP 400, so the tool is not
//      forced; the system prompt (rule 2) tells the model to call it first.
//   2. Code enforces that rule: if the FIRST response has no `tool_use` block
//      named `get_assessment`, the loop stops at once with
//      `assessmentCalled: false` and no further call; the route then returns the
//      fallback (the model never answers without the engine's facts).
//   3. When the model stops with `tool_use`, we echo its turn back and reply with a
//      `tool_result` for each `tool_use` block — the real assessment JSON for
//      `get_assessment`, an `is_error` result for any other (unexpected) tool —
//      then call again (still `auto`).
//   4. The loop stops at `stop_reason === "end_turn"` or after 3 calls total.
//   5. A `max_tokens` stop is treated as a MODEL FAILURE: we throw `ModelError`
//      and return no partial text, so the route maps it to `model_error` (502).
//
// The Anthropic client is INJECTED (`deps.client`) and never created here — the
// route builds the real client only when `ANTHROPIC_API_KEY` is set (task 7.2),
// and the unit tests (task 6.3) pass a fake that satisfies
// `Pick<Anthropic, "messages">`. This keeps `runChat` a pure function of its
// dependencies and fully testable without a network.

import type Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn } from "./request";
import { SYSTEM_PROMPT, toolDefinitions } from "./prompt";

/**
 * The maximum number of `messages.create` calls per question. One tool-calling
 * turn, one follow-up after the tool result, and one spare — three total is the
 * hard ceiling so a misbehaving model cannot loop forever (design.md: "≤ 3 calls").
 */
const MAX_CALLS = 3;

/** The one tool the model may call; its result is the engine's assessment JSON. */
const ASSESSMENT_TOOL = "get_assessment";

/**
 * Thrown when the model fails in a way that must not surface partial text:
 * currently a `max_tokens` stop (the answer was cut off mid-generation). The route
 * catches this and returns the `model_error` (502) response shape; it never leaks
 * the message to the client (design.md "Error Handling").
 */
export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}

/**
 * Everything `runChat` needs, all injected so the function stays testable:
 *   - `client`    anything with a `messages.create` — the real SDK client or a fake.
 *   - `model`     the model id (e.g. `claude-sonnet-4-5`), chosen by the route.
 *   - `maxTokens` the per-call output cap passed as `max_tokens`.
 *   - `signal`    an AbortSignal (the route uses `AbortSignal.timeout(45_000)`);
 *                 passed to every `create` call so the whole loop cancels at once.
 */
export interface ChatDeps {
  client: Pick<Anthropic, "messages">;
  model: string;
  maxTokens: number;
  signal: AbortSignal;
}

/**
 * The result of a completed loop:
 *   - `text`   the final answer: the concatenated `text` blocks of the LAST
 *              assistant turn (empty string if that turn had no text blocks).
 *   - `usage`  one `Usage` entry per `messages.create` call, in call order, so the
 *              route can log/sum input and output tokens.
 *   - `calls`  how many `messages.create` calls were made (1 ≤ calls ≤ 3).
 *   - `assessmentCalled` whether the FIRST response called `get_assessment`.
 *              `false` means the loop stopped after that one call with
 *              `text: ""` (the unchecked model text is dropped); the caller must
 *              return the fallback instead of any model text.
 */
export interface ChatResult {
  text: string;
  usage: Anthropic.Messages.Usage[];
  calls: number;
  assessmentCalled: boolean;
}

/**
 * Build the static `system` blocks with a prompt-cache marker on the LAST block.
 * Per the `cache_control` note in `prompt.ts`, `SYSTEM_PROMPT` is a single text
 * block tagged `cache_control: { type: "ephemeral" }`. Kept as a function so the
 * block shape lives at the call site (this module owns the SDK types, `prompt.ts`
 * stays SDK-free).
 */
function systemBlocks(): Anthropic.Messages.TextBlockParam[] {
  return [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ];
}

/**
 * Build the `tools` array with a prompt-cache marker on the LAST tool definition
 * (here the only one). The plain `toolDefinitions` from `prompt.ts` are a
 * structural subset of the SDK's `Tool`, so we spread each into a `Tool` and add
 * `cache_control` to the final entry.
 */
function toolBlocks(): Anthropic.Messages.Tool[] {
  const lastIndex = toolDefinitions.length - 1;
  return toolDefinitions.map((tool, index) => {
    const base: Anthropic.Messages.Tool = {
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
      // Pass `strict` through so the API enforces the tool's input schema.
      strict: tool.strict,
    };
    return index === lastIndex
      ? { ...base, cache_control: { type: "ephemeral" } }
      : base;
  });
}

/**
 * Concatenate the `text` blocks of an assistant message into a single string.
 * Non-text blocks (e.g. `tool_use`) are skipped; a turn with no text yields "".
 */
function textOf(message: Anthropic.Messages.Message): string {
  return message.content
    .filter(
      (block): block is Anthropic.Messages.TextBlock => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/** True when the message contains at least one `tool_use` block for `get_assessment`. */
function callsAssessment(message: Anthropic.Messages.Message): boolean {
  return message.content.some(
    (block) => block.type === "tool_use" && block.name === ASSESSMENT_TOOL,
  );
}

/**
 * Build the `tool_result` user turn that answers an assistant's `tool_use` turn.
 * For every `tool_use` block we emit one `tool_result` block keyed by its
 * `tool_use_id`:
 *   - `get_assessment` → the real assessment JSON (`content: toolResult`).
 *   - anything else    → `is_error: true` with a short, content-free message
 *                        (the model only has one tool, so this is defensive).
 * Blocks that are not `tool_use` (e.g. the model's thinking text) are ignored.
 */
function toolResultsFor(
  message: Anthropic.Messages.Message,
  toolResult: string,
): Anthropic.Messages.ToolResultBlockParam[] {
  const results: Anthropic.Messages.ToolResultBlockParam[] = [];
  for (const block of message.content) {
    if (block.type !== "tool_use") continue;
    if (block.name === ASSESSMENT_TOOL) {
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: toolResult,
      });
    } else {
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        is_error: true,
        content: `Unknown tool: ${block.name}. Only ${ASSESSMENT_TOOL} is available.`,
      });
    }
  }
  return results;
}

/**
 * Run the Claude tool loop and return the final answer.
 *
 * @param deps       injected client, model, token cap and abort signal.
 * @param question   the clinician's current question (the latest user turn).
 * @param history    prior turns, already mapped by the route to the model-safe
 *                   subset (user turns and already-guarded assistant texts). Each
 *                   `ChatTurn {role, text}` becomes `{ role, content: text }`.
 * @param toolResult the serialized assessment JSON returned for every
 *                   `get_assessment` call (built once by the route).
 *
 * @throws {ModelError} if any call stops with `max_tokens` (the output was cut
 *   off), or if the loop ends without a usable `end_turn` assistant turn.
 */
export async function runChat(
  deps: ChatDeps,
  question: string,
  history: ChatTurn[],
  toolResult: string,
): Promise<ChatResult> {
  // Seed the conversation with the prior turns and the new question. `history` is
  // forwarded as-is: the route is responsible for only including user turns and
  // already-guarded assistant texts (design.md "Request").
  const messages: Anthropic.Messages.MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: question },
  ];

  // Static per-request pieces, built once and reused on every call so the prompt
  // cache can hit (the cache_control markers live on these blocks).
  const system = systemBlocks();
  const tools = toolBlocks();

  const usage: Anthropic.Messages.Usage[] = [];
  let calls = 0;
  let last: Anthropic.Messages.Message | null = null;

  while (calls < MAX_CALLS) {
    const isFirstCall = calls === 0;

    // `auto` on EVERY call: a forced `tool`/`any` choice is rejected (HTTP 400)
    // by the current models, so the "tool first" rule is enforced in code below.
    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: deps.model,
      max_tokens: deps.maxTokens,
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
    };

    // The abort signal is passed as the request option so it cancels the actual
    // HTTP call — not just the loop between calls.
    const response = await deps.client.messages.create(params, {
      signal: deps.signal,
    });

    calls += 1;
    usage.push(response.usage);
    last = response;

    // A cut-off generation is a model failure at ANY point: there is no usable
    // answer to return, so throw rather than surface partial, possibly-uncited
    // text (design.md: "max_tokens stop on the final call → model failure").
    if (response.stop_reason === "max_tokens") {
      throw new ModelError("Model response exceeded max_tokens");
    }

    // The first response skipped `get_assessment`: whatever it says was written
    // without the engine's facts. Stop now (no further call) and drop its text;
    // the route returns the fallback (Requirement 3.3).
    if (isFirstCall && !callsAssessment(response)) {
      return { text: "", usage, calls, assessmentCalled: false };
    }

    // The model finished its answer — stop and return its text.
    if (response.stop_reason === "end_turn") {
      return { text: textOf(response), usage, calls, assessmentCalled: true };
    }

    // The model asked to use a tool. Echo its turn, then answer every tool_use
    // block with a tool_result, and loop for the follow-up call.
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResultsFor(response, toolResult) });
      continue;
    }

    // Any other stop reason (`stop_sequence`, `pause_turn`, `refusal`,
    // `model_context_window_exceeded`, …) is unexpected for this simple loop. We
    // do not try to continue it; fall through so the call-limit / no-answer check
    // below decides the outcome.
    break;
  }

  // We left the loop without an `end_turn`. If the last turn was still asking for
  // a tool after hitting the call limit — or stopped for an unhandled reason — we
  // have no completed answer. Return its text only if it produced some; otherwise
  // this is a model failure.
  if (last && last.stop_reason !== "tool_use") {
    const text = textOf(last);
    if (text.length > 0) {
      return { text, usage, calls, assessmentCalled: true };
    }
  }

  throw new ModelError(
    `Model did not produce a final answer within ${MAX_CALLS} calls`,
  );
}
