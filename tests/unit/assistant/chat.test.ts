import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ModelError,
  runChat,
  type ChatDeps,
} from "@/app/api/assistant/chat";
import { SYSTEM_PROMPT, toolDefinitions } from "@/app/api/assistant/prompt";
import type { ChatTurn } from "@/app/api/assistant/request";

// ---------------------------------------------------------------------------
// Test doubles
//
// `runChat` reads only three things off each `messages.create` response:
// `content`, `stop_reason` and `usage`. We build minimal canned `Message`
// objects that carry exactly those, plus the required `role`/`type`/`id`
// envelope, and cast through `unknown` so we never have to satisfy every SDK
// field. The fake client is a bare object that structurally satisfies
// `Pick<Anthropic, "messages">` — a `messages.create` that is a Vitest mock we
// can seed per call and inspect afterwards.
// ---------------------------------------------------------------------------

type CreateFn = ReturnType<typeof vi.fn>;

/** A fake client with an inspectable, per-call-seedable `messages.create`. */
function makeClient(): { create: CreateFn; client: ChatDeps["client"] } {
  const create = vi.fn();
  const client = { messages: { create } } as unknown as ChatDeps["client"];
  return { create, client };
}

/** A distinct, valid-enough `Usage` so tests can assert the array by identity. */
function makeUsage(inputTokens: number): Anthropic.Messages.Usage {
  return {
    input_tokens: inputTokens,
    output_tokens: 1,
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
  } as unknown as Anthropic.Messages.Usage;
}

/** A text content block. */
function textBlock(text: string): Anthropic.Messages.ContentBlock {
  return {
    type: "text",
    text,
    citations: null,
  } as unknown as Anthropic.Messages.ContentBlock;
}

/** A `tool_use` content block with a caller-chosen id and tool name. */
function toolUseBlock(
  id: string,
  name: string,
): Anthropic.Messages.ContentBlock {
  return {
    type: "tool_use",
    id,
    name,
    input: {},
  } as unknown as Anthropic.Messages.ContentBlock;
}

/**
 * Build a canned `Message` with the given stop reason, content blocks and
 * usage. Everything else is filler the loop never reads.
 */
function makeMessage(options: {
  stopReason: Anthropic.Messages.Message["stop_reason"];
  content: Anthropic.Messages.ContentBlock[];
  usage: Anthropic.Messages.Usage;
}): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    stop_reason: options.stopReason,
    stop_sequence: null,
    content: options.content,
    usage: options.usage,
  } as unknown as Anthropic.Messages.Message;
}

/** Standard deps with a fresh signal; callers override fields as needed. */
function makeDeps(
  client: ChatDeps["client"],
  overrides: Partial<ChatDeps> = {},
): ChatDeps {
  return {
    client,
    model: "claude-sonnet-4-5",
    maxTokens: 1024,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const TOOL_RESULT = '{"findings":[],"disclaimer":"demo"}';

/** Pull the first positional arg (the params) of the Nth `create` call. */
function paramsOf(
  create: CreateFn,
  callIndex: number,
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return create.mock.calls[callIndex][0];
}

/** Pull the request-options arg (the second positional arg) of the Nth call. */
function optionsOf(
  create: CreateFn,
  callIndex: number,
): { signal?: AbortSignal } | undefined {
  return create.mock.calls[callIndex][1];
}

/** Seed a first `tool_use` turn for get_assessment, then an `end_turn` with text. */
function seedToolThenAnswer(create: CreateFn, answer: string): void {
  create
    .mockResolvedValueOnce(
      makeMessage({
        stopReason: "tool_use",
        content: [toolUseBlock("toolu_1", "get_assessment")],
        usage: makeUsage(1),
      }),
    )
    .mockResolvedValueOnce(
      makeMessage({
        stopReason: "end_turn",
        content: [textBlock(answer)],
        usage: makeUsage(2),
      }),
    );
}

// ---------------------------------------------------------------------------
// 1. First call: auto tool choice, cached system + tools
// ---------------------------------------------------------------------------

describe("runChat — first call", () => {
  it("uses tool_choice auto and sends cached system + tools on the first call", async () => {
    const { create, client } = makeClient();
    seedToolThenAnswer(create, "done [F1]");

    await runChat(makeDeps(client), "What is the grade?", [], TOOL_RESULT);

    const params = paramsOf(create, 0);

    // The tool is never forced (forced choices are rejected by the API).
    expect(params.tool_choice).toEqual({ type: "auto" });

    // System is a single text block carrying the prompt and a cache marker.
    const system = params.system as Anthropic.Messages.TextBlockParam[];
    expect(Array.isArray(system)).toBe(true);
    expect(system).toHaveLength(1);
    expect(system[0]).toMatchObject({
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    });

    // Tools mirror toolDefinitions; the LAST one carries the cache marker.
    const tools = params.tools as Anthropic.Messages.Tool[];
    expect(tools).toHaveLength(toolDefinitions.length);
    expect(tools[0].name).toBe("get_assessment");
    expect(tools[tools.length - 1].cache_control).toEqual({
      type: "ephemeral",
    });

    // model / max_tokens are forwarded.
    expect(params.model).toBe("claude-sonnet-4-5");
    expect(params.max_tokens).toBe(1024);
  });

  it("forwards history then appends the current question as the last user turn", async () => {
    const { create, client } = makeClient();
    seedToolThenAnswer(create, "ok [F1]");

    const history: ChatTurn[] = [
      { role: "user", text: "Earlier question" },
      { role: "assistant", text: "Earlier answer [F1]" },
    ];

    await runChat(makeDeps(client), "Latest question", history, TOOL_RESULT);

    // runChat appends to the same array after call 1 (the mock keeps a
    // reference), so compare the seeded prefix only.
    const messages = paramsOf(create, 0).messages.slice(0, 3);
    expect(messages).toEqual([
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer [F1]" },
      { role: "user", content: "Latest question" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 1b. First response without get_assessment → stop, assessmentCalled: false
// ---------------------------------------------------------------------------

describe("runChat — first response skips get_assessment", () => {
  it("stops after one call with assessmentCalled false and no text when the model answers directly", async () => {
    const { create, client } = makeClient();
    const u1 = makeUsage(7);
    create.mockResolvedValueOnce(
      makeMessage({
        stopReason: "end_turn",
        content: [textBlock("Severe aortic stenosis [F1]")],
        usage: u1,
      }),
    );

    const result = await runChat(makeDeps(client), "Grade?", [], TOOL_RESULT);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      text: "",
      usage: [u1],
      calls: 1,
      assessmentCalled: false,
    });
  });

  it("stops after one call when the first response uses only another tool", async () => {
    const { create, client } = makeClient();
    create.mockResolvedValueOnce(
      makeMessage({
        stopReason: "tool_use",
        content: [toolUseBlock("toolu_x", "some_other_tool")],
        usage: makeUsage(1),
      }),
    );

    const result = await runChat(makeDeps(client), "Grade?", [], TOOL_RESULT);

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.assessmentCalled).toBe(false);
    expect(result.text).toBe("");
  });

  it("reports assessmentCalled true when the first response calls get_assessment", async () => {
    const { create, client } = makeClient();
    seedToolThenAnswer(create, "ok [F1]");

    const result = await runChat(makeDeps(client), "Grade?", [], TOOL_RESULT);

    expect(result.assessmentCalled).toBe(true);
    expect(result.text).toBe("ok [F1]");
  });
});

// ---------------------------------------------------------------------------
// 2. tool_result sent on the follow-up call
// ---------------------------------------------------------------------------

describe("runChat — tool_result follow-up", () => {
  it("echoes the assistant turn and answers the tool_use with the toolResult, then uses auto", async () => {
    const { create, client } = makeClient();
    const assistantTurn = [toolUseBlock("toolu_1", "get_assessment")];
    create
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "tool_use",
          content: assistantTurn,
          usage: makeUsage(1),
        }),
      )
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "end_turn",
          content: [textBlock("The grade is severe [F1]")],
          usage: makeUsage(2),
        }),
      );

    await runChat(makeDeps(client), "Grade?", [], TOOL_RESULT);

    expect(create).toHaveBeenCalledTimes(2);

    const secondParams = paramsOf(create, 1);
    const messages = secondParams.messages;

    // messages: [user question, assistant tool_use turn, user tool_result turn].
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "Grade?" });
    expect(messages[1]).toEqual({
      role: "assistant",
      content: assistantTurn,
    });

    const toolResultTurn = messages[2];
    expect(toolResultTurn.role).toBe("user");
    const blocks =
      toolResultTurn.content as Anthropic.Messages.ToolResultBlockParam[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: TOOL_RESULT,
    });
    expect(blocks[0].is_error).toBeUndefined();

    // The second call lets the model decide.
    expect(secondParams.tool_choice).toEqual({ type: "auto" });
  });
});

// ---------------------------------------------------------------------------
// 3. Normal completion
// ---------------------------------------------------------------------------

describe("runChat — normal completion", () => {
  it("returns concatenated text, call count and usage in call order", async () => {
    const { create, client } = makeClient();
    const u1 = makeUsage(10);
    const u2 = makeUsage(20);
    create
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "tool_use",
          content: [toolUseBlock("toolu_1", "get_assessment")],
          usage: u1,
        }),
      )
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "end_turn",
          content: [textBlock("Severe aortic stenosis [F1]"), textBlock(" and reduced LV function [F2]")],
          usage: u2,
        }),
      );

    const result = await runChat(makeDeps(client), "Summary?", [], TOOL_RESULT);

    expect(result.text).toBe(
      "Severe aortic stenosis [F1] and reduced LV function [F2]",
    );
    expect(result.calls).toBe(2);
    expect(result.usage).toEqual([u1, u2]);
    // Usage entries are the exact objects returned, in call order.
    expect(result.usage[0]).toBe(u1);
    expect(result.usage[1]).toBe(u2);
  });
});

// ---------------------------------------------------------------------------
// 4. Stops at MAX_CALLS (3)
// ---------------------------------------------------------------------------

describe("runChat — call ceiling", () => {
  it("throws ModelError after exactly 3 calls when the model never finishes", async () => {
    const { create, client } = makeClient();
    create.mockResolvedValue(
      makeMessage({
        stopReason: "tool_use",
        content: [toolUseBlock("toolu_loop", "get_assessment")],
        usage: makeUsage(1),
      }),
    );

    await expect(
      runChat(makeDeps(client), "Loop?", [], TOOL_RESULT),
    ).rejects.toBeInstanceOf(ModelError);

    expect(create).toHaveBeenCalledTimes(3);
    // tool_choice auto on every call, never a forced tool.
    for (let i = 0; i < 3; i += 1) {
      expect(paramsOf(create, i).tool_choice).toEqual({ type: "auto" });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. max_tokens → ModelError, no partial text
// ---------------------------------------------------------------------------

describe("runChat — max_tokens stop", () => {
  it("rejects with ModelError and surfaces no partial text", async () => {
    const { create, client } = makeClient();
    create.mockResolvedValueOnce(
      makeMessage({
        stopReason: "max_tokens",
        content: [textBlock("partial answer that should never surface")],
        usage: makeUsage(1),
      }),
    );

    await expect(
      runChat(makeDeps(client), "Long?", [], TOOL_RESULT),
    ).rejects.toThrow(ModelError);

    // One call only — it bailed immediately on the cut-off stop.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("treats a max_tokens stop on the follow-up call as a failure too", async () => {
    const { create, client } = makeClient();
    create
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "tool_use",
          content: [toolUseBlock("toolu_1", "get_assessment")],
          usage: makeUsage(1),
        }),
      )
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "max_tokens",
          content: [textBlock("cut off [F1]")],
          usage: makeUsage(2),
        }),
      );

    await expect(
      runChat(makeDeps(client), "Long?", [], TOOL_RESULT),
    ).rejects.toBeInstanceOf(ModelError);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Unknown tool name → is_error tool_result
// ---------------------------------------------------------------------------

describe("runChat — unknown tool name", () => {
  it("answers an unexpected tool with an is_error tool_result, then completes", async () => {
    const { create, client } = makeClient();
    create
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "tool_use",
          content: [
            toolUseBlock("toolu_1", "get_assessment"),
            toolUseBlock("toolu_x", "some_other_tool"),
          ],
          usage: makeUsage(1),
        }),
      )
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "end_turn",
          content: [textBlock("Recovered [F1]")],
          usage: makeUsage(2),
        }),
      );

    const result = await runChat(
      makeDeps(client),
      "Try a bad tool",
      [],
      TOOL_RESULT,
    );

    const blocks = paramsOf(create, 1).messages[2]
      .content as Anthropic.Messages.ToolResultBlockParam[];
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: TOOL_RESULT,
    });
    expect(blocks[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_x",
      is_error: true,
    });
    // The is_error result must NOT carry the real assessment JSON.
    expect(blocks[1].content).not.toBe(TOOL_RESULT);

    expect(result.text).toBe("Recovered [F1]");
    expect(result.calls).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Abort signal forwarded
// ---------------------------------------------------------------------------

describe("runChat — abort signal", () => {
  it("passes deps.signal as the request option on every call", async () => {
    const { create, client } = makeClient();
    const controller = new AbortController();
    create
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "tool_use",
          content: [toolUseBlock("toolu_1", "get_assessment")],
          usage: makeUsage(1),
        }),
      )
      .mockResolvedValueOnce(
        makeMessage({
          stopReason: "end_turn",
          content: [textBlock("ok [F1]")],
          usage: makeUsage(2),
        }),
      );

    await runChat(
      makeDeps(client, { signal: controller.signal }),
      "Q?",
      [],
      TOOL_RESULT,
    );

    expect(optionsOf(create, 0)?.signal).toBe(controller.signal);
    expect(optionsOf(create, 1)?.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// 8. strict passed through from toolDefinitions
// ---------------------------------------------------------------------------

describe("runChat — tool strict flag", () => {
  it("sends strict from toolDefinitions on every tool", async () => {
    const { create, client } = makeClient();
    create.mockResolvedValueOnce(
      makeMessage({
        stopReason: "end_turn",
        content: [textBlock("ok [F1]")],
        usage: makeUsage(1),
      }),
    );

    await runChat(makeDeps(client), "Q?", [], TOOL_RESULT);

    const tools = paramsOf(create, 0).tools as Anthropic.Messages.Tool[];
    expect(tools.map((t) => t.strict)).toEqual(
      toolDefinitions.map((t) => t.strict),
    );
    expect(tools[0].strict).toBe(true);
  });
});
