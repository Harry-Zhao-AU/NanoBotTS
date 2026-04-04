/**
 * End-to-end verification tests.
 *
 * Uses a MockProvider that returns scripted responses so we can
 * verify the full pipeline without hitting a real LLM API:
 *   MessageBus → AgentLoop → AgentRunner → Tools → Hooks → back to bus
 */

import { describe, it, expect, beforeEach } from "vitest";
import { LLMProvider, GenerationSettings } from "../src/providers/base.js";
import { LLMResponse, Message, ToolCall } from "../src/types.js";
import { ToolRegistry } from "../src/tools/base.js";
import { TimeTool } from "../src/tools/time.js";
import { AgentRunner } from "../src/core/agent.js";
import { AgentHook } from "../src/core/hook.js";
import { MessageBus } from "../src/bus/queue.js";
import { SessionManager } from "../src/session/manager.js";
import { Session } from "../src/core/session.js";
import type { ChatCompletionTool } from "openai/resources/index";

// ── Mock Provider ──────────────────────────────────────────────

type ScriptedResponse = {
  content: string | null;
  toolCalls?: ToolCall[];
};

class MockProvider extends LLMProvider {
  /** Queue of responses to return — shifted one at a time */
  responses: ScriptedResponse[] = [];
  /** Record of all messages sent to the provider */
  callLog: Message[][] = [];

  constructor() {
    super({ temperature: 0, maxTokens: 100 });
  }

  /** Push a simple text response */
  willRespond(content: string): void {
    this.responses.push({ content, toolCalls: [] });
  }

  /** Push a tool-call response */
  willCallTool(name: string, args: Record<string, unknown>, callId: string = "call_1"): void {
    this.responses.push({
      content: null,
      toolCalls: [{
        id: callId,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      }],
    });
  }

  async chat(messages: Message[]): Promise<string> {
    this.callLog.push([...messages]);
    const resp = this.responses.shift();
    return resp?.content ?? "";
  }

  async chatWithTools(messages: Message[], _tools: ChatCompletionTool[]): Promise<LLMResponse> {
    this.callLog.push([...messages]);
    const resp = this.responses.shift();
    return {
      content: resp?.content ?? null,
      toolCalls: resp?.toolCalls ?? [],
      finishReason: (resp?.toolCalls?.length ?? 0) > 0 ? "tool_calls" : "stop",
    };
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    this.callLog.push([...messages]);
    const resp = this.responses.shift();
    if (resp?.content) yield resp.content;
  }
}

// ── Mock Tool ──────────────────────────────────────────────────

function createEchoTool() {
  return {
    name: "echo",
    description: "Echoes back the input",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    readOnly: true,
    concurrencySafe: true,
    async execute(args: Record<string, unknown>): Promise<string> {
      return `Echo: ${args.text}`;
    },
  };
}

function createCounterTool() {
  let count = 0;
  return {
    name: "counter",
    description: "Increments and returns a counter",
    parameters: { type: "object", properties: {}, required: [] },
    readOnly: false,
    concurrencySafe: false,
    async execute(): Promise<string> {
      count++;
      return `Count: ${count}`;
    },
    getCount: () => count,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("AgentRunner", () => {
  let provider: MockProvider;
  let registry: ToolRegistry;
  let agent: AgentRunner;

  beforeEach(() => {
    provider = new MockProvider();
    registry = new ToolRegistry();
    registry.register(createEchoTool());
    registry.register(createCounterTool());
    registry.register(new TimeTool());
    agent = new AgentRunner(provider, registry, 10);
  });

  it("returns a simple text response", async () => {
    provider.willRespond("Hello, world!");

    const messages: Message[] = [
      { role: "system", content: "You are a bot" },
      { role: "user", content: "Hi" },
    ];

    const result = await agent.run(messages);
    expect(result).toBe("Hello, world!");
    expect(provider.callLog).toHaveLength(1);
  });

  it("executes a tool call and returns final response", async () => {
    // First LLM call: requests echo tool
    provider.willCallTool("echo", { text: "hello" });
    // Second LLM call: returns final response after seeing tool result
    provider.willRespond("The echo said: hello");

    const messages: Message[] = [
      { role: "system", content: "You are a bot" },
      { role: "user", content: "Echo hello" },
    ];

    const result = await agent.run(messages);
    expect(result).toBe("The echo said: hello");
    // Two LLM calls: one that triggered tool, one final
    expect(provider.callLog).toHaveLength(2);
    // Messages array should contain tool result
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content).toBe("Echo: hello");
  });

  it("executes multiple tool calls in one response", async () => {
    // LLM requests two echo calls at once
    provider.responses.push({
      content: null,
      toolCalls: [
        { id: "c1", type: "function", function: { name: "echo", arguments: '{"text":"a"}' } },
        { id: "c2", type: "function", function: { name: "echo", arguments: '{"text":"b"}' } },
      ],
    });
    provider.willRespond("Got both echoes");

    const messages: Message[] = [
      { role: "user", content: "Echo a and b" },
    ];

    const result = await agent.run(messages);
    expect(result).toBe("Got both echoes");

    // Both tool results should be in messages
    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
  });

  it("concurrent-safe tools run in parallel", async () => {
    // echo is concurrencySafe=true, counter is concurrencySafe=false
    // If we send two echo calls, they should run via Promise.all
    provider.responses.push({
      content: null,
      toolCalls: [
        { id: "c1", type: "function", function: { name: "echo", arguments: '{"text":"1"}' } },
        { id: "c2", type: "function", function: { name: "echo", arguments: '{"text":"2"}' } },
      ],
    });
    provider.willRespond("Done");

    const messages: Message[] = [{ role: "user", content: "go" }];
    await agent.run(messages);

    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect((toolMsgs[0] as any).content).toBe("Echo: 1");
    expect((toolMsgs[1] as any).content).toBe("Echo: 2");
  });

  it("sequential tools run one at a time in order", async () => {
    // counter is concurrencySafe=false — should run sequentially
    provider.responses.push({
      content: null,
      toolCalls: [
        { id: "c1", type: "function", function: { name: "counter", arguments: "{}" } },
        { id: "c2", type: "function", function: { name: "counter", arguments: "{}" } },
      ],
    });
    provider.willRespond("Done");

    const messages: Message[] = [{ role: "user", content: "go" }];
    await agent.run(messages);

    const toolMsgs = messages.filter((m) => m.role === "tool");
    expect((toolMsgs[0] as any).content).toBe("Count: 1");
    expect((toolMsgs[1] as any).content).toBe("Count: 2");
  });

  it("handles unknown tool gracefully", async () => {
    provider.willCallTool("nonexistent", {});
    provider.willRespond("OK");

    const messages: Message[] = [{ role: "user", content: "go" }];
    const result = await agent.run(messages);

    expect(result).toBe("OK");
    const toolMsg = messages.find((m) => m.role === "tool");
    expect((toolMsg as any).content).toContain("Error");
    expect((toolMsg as any).content).toContain("nonexistent");
  });

  it("respects max iterations", async () => {
    // Agent with max 2 iterations — keep requesting tools forever
    const limitedAgent = new AgentRunner(provider, registry, 2);

    provider.willCallTool("echo", { text: "1" });
    provider.willCallTool("echo", { text: "2" });
    provider.willCallTool("echo", { text: "3" }); // won't reach this

    const messages: Message[] = [{ role: "user", content: "go" }];
    const result = await limitedAgent.run(messages);

    expect(result).toContain("maximum number of steps");
    expect(provider.callLog).toHaveLength(2);
  });

  it("streams final response via onStream callback", async () => {
    provider.willRespond("Streamed content");

    const chunks: string[] = [];
    const messages: Message[] = [{ role: "user", content: "Hi" }];

    const result = await agent.run(messages, (chunk) => chunks.push(chunk));

    expect(result).toBe("Streamed content");
    expect(chunks).toEqual(["Streamed content"]);
  });

  it("truncates large tool results", async () => {
    // Create agent with tiny tool result budget (50 tokens ~ 200 chars)
    const smallAgent = new AgentRunner(provider, registry, 10, 120000, 50);

    const bigText = "x".repeat(1000);
    registry.register({
      name: "big_output",
      description: "Returns a huge string",
      parameters: { type: "object", properties: {}, required: [] },
      readOnly: true,
      concurrencySafe: true,
      async execute(): Promise<string> {
        return bigText;
      },
    });

    provider.willCallTool("big_output", {});
    provider.willRespond("Got it");

    const messages: Message[] = [{ role: "user", content: "go" }];
    await smallAgent.run(messages);

    const toolMsg = messages.find((m) => m.role === "tool");
    expect((toolMsg as any).content).toContain("truncated");
    expect((toolMsg as any).content.length).toBeLessThan(bigText.length);
  });
});

describe("Hooks", () => {
  let provider: MockProvider;
  let registry: ToolRegistry;
  let agent: AgentRunner;

  beforeEach(() => {
    provider = new MockProvider();
    registry = new ToolRegistry();
    registry.register(createEchoTool());
    agent = new AgentRunner(provider, registry, 10);
  });

  it("beforeIteration hook fires for each iteration", async () => {
    const iterations: number[] = [];
    agent.addHook({
      async beforeIteration(i) { iterations.push(i); },
    });

    provider.willCallTool("echo", { text: "hi" });
    provider.willRespond("Done");

    await agent.run([{ role: "user", content: "go" }]);
    expect(iterations).toEqual([0, 1]);
  });

  it("beforeIteration returning false aborts the loop", async () => {
    agent.addHook({
      async beforeIteration() { return false; },
    });

    provider.willRespond("Should not reach");

    const result = await agent.run([{ role: "user", content: "go" }]);
    expect(result).toContain("maximum number of steps");
    expect(provider.callLog).toHaveLength(0); // provider never called
  });

  it("beforeExecuteTools fires with tool calls", async () => {
    const toolNames: string[] = [];
    agent.addHook({
      async beforeExecuteTools(toolCalls) {
        toolNames.push(...toolCalls.map((tc) => tc.function.name));
      },
    });

    provider.willCallTool("echo", { text: "hi" });
    provider.willRespond("Done");

    await agent.run([{ role: "user", content: "go" }]);
    expect(toolNames).toEqual(["echo"]);
  });

  it("afterIteration fires after tool execution (correct order)", async () => {
    const events: string[] = [];
    agent.addHook({
      async beforeExecuteTools() { events.push("before_tools"); },
      async afterIteration() { events.push("after_iteration"); },
    });

    provider.willCallTool("echo", { text: "hi" });
    provider.willRespond("Done");

    await agent.run([{ role: "user", content: "go" }]);
    // after_iteration should come AFTER before_tools, not before
    expect(events).toEqual(["before_tools", "after_iteration", "after_iteration"]);
  });

  it("finalizeContent transforms the output", async () => {
    agent.addHook({
      async finalizeContent(content) {
        return content.toUpperCase();
      },
    });

    provider.willRespond("hello world");

    const result = await agent.run([{ role: "user", content: "go" }]);
    expect(result).toBe("HELLO WORLD");
  });

  it("multiple hooks chain — finalizeContent runs in order", async () => {
    agent.addHook({
      async finalizeContent(content) { return content + " [hook1]"; },
    });
    agent.addHook({
      async finalizeContent(content) { return content + " [hook2]"; },
    });

    provider.willRespond("base");

    const result = await agent.run([{ role: "user", content: "go" }]);
    expect(result).toBe("base [hook1] [hook2]");
  });

  it("onStream and onStreamEnd fire for final response", async () => {
    const events: string[] = [];
    agent.addHook({
      onStream(chunk) { events.push(`stream:${chunk}`); },
      onStreamEnd() { events.push("stream_end"); },
    });

    provider.willRespond("Hi there");

    await agent.run([{ role: "user", content: "go" }], () => {});
    expect(events).toEqual(["stream:Hi there", "stream_end"]);
  });

  it("a failing hook does not break other hooks", async () => {
    const results: string[] = [];

    agent.addHook({
      async afterIteration() { throw new Error("hook1 exploded"); },
    });
    agent.addHook({
      async afterIteration() { results.push("hook2 ran"); },
    });

    provider.willRespond("Done");

    const result = await agent.run([{ role: "user", content: "go" }]);
    expect(result).toBe("Done");
    expect(results).toEqual(["hook2 ran"]);
  });
});

describe("MessageBus", () => {
  it("inbound: enqueue then dequeue returns immediately", async () => {
    const bus = new MessageBus();

    bus.publishInbound({
      channel: "test",
      sessionKey: "s1",
      chatId: "c1",
      senderName: "User",
      content: "Hello",
    });

    const msg = await bus.consumeInbound();
    expect(msg.content).toBe("Hello");
    expect(msg.channel).toBe("test");
  });

  it("inbound: dequeue before enqueue waits", async () => {
    const bus = new MessageBus();

    // Start consuming (will block)
    const promise = bus.consumeInbound();

    // Enqueue after a short delay
    setTimeout(() => {
      bus.publishInbound({
        channel: "test",
        sessionKey: "s1",
        chatId: "c1",
        senderName: "User",
        content: "Delayed",
      });
    }, 10);

    const msg = await promise;
    expect(msg.content).toBe("Delayed");
  });

  it("outbound: messages route correctly", async () => {
    const bus = new MessageBus();

    bus.publishOutbound({
      channel: "cli",
      chatId: "cli",
      content: "Response",
      isDelta: false,
      isFinal: true,
    });

    const msg = await bus.consumeOutbound();
    expect(msg.channel).toBe("cli");
    expect(msg.content).toBe("Response");
    expect(msg.isFinal).toBe(true);
  });

  it("preserves FIFO ordering", async () => {
    const bus = new MessageBus();

    bus.publishInbound({ channel: "t", sessionKey: "s", chatId: "c", senderName: "U", content: "first" });
    bus.publishInbound({ channel: "t", sessionKey: "s", chatId: "c", senderName: "U", content: "second" });
    bus.publishInbound({ channel: "t", sessionKey: "s", chatId: "c", senderName: "U", content: "third" });

    const m1 = await bus.consumeInbound();
    const m2 = await bus.consumeInbound();
    const m3 = await bus.consumeInbound();

    expect([m1.content, m2.content, m3.content]).toEqual(["first", "second", "third"]);
  });
});

describe("ToolRegistry", () => {
  it("validates required parameters", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    const errors = registry.validate("echo", {});
    expect(errors).toContain('Missing required parameter: "text"');
  });

  it("validates with no errors for correct args", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    const errors = registry.validate("echo", { text: "hello" });
    expect(errors).toHaveLength(0);
  });

  it("castParams converts string numbers", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "num_tool",
      description: "test",
      parameters: {
        type: "object",
        properties: { count: { type: "number" } },
        required: ["count"],
      },
      async execute(args) { return `${args.count}`; },
    });

    const cast = registry.castParams("num_tool", { count: "42" });
    expect(cast.count).toBe(42);
  });

  it("prepareCall throws on invalid JSON", () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    expect(() => registry.prepareCall("echo", "not json")).toThrow("Invalid JSON");
  });

  it("prepareCall throws on unknown tool", () => {
    const registry = new ToolRegistry();
    expect(() => registry.prepareCall("nope", "{}")).toThrow("Unknown tool");
  });

  it("execute runs the tool end-to-end", async () => {
    const registry = new ToolRegistry();
    registry.register(createEchoTool());

    const result = await registry.execute("echo", '{"text":"hi"}');
    expect(result).toBe("Echo: hi");
  });
});

describe("Session", () => {
  it("stores and retrieves messages", () => {
    const session = new Session();
    session.addMessage("system", "You are a bot");
    session.addMessage("user", "Hi");

    const msgs = session.getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toBe("Hi");
  });

  it("trims history beyond maxMessages", () => {
    const session = new Session(4);
    session.addMessage("system", "sys");
    session.addMessage("user", "m1");
    session.addMessage("assistant", "r1");
    session.addMessage("user", "m2");
    session.addMessage("assistant", "r2");
    session.addMessage("user", "m3"); // should trigger trim

    const msgs = session.getMessages();
    // System message always kept + last 4 conversation messages
    expect(msgs[0].role).toBe("system");
    expect(msgs.length).toBeLessThanOrEqual(5); // sys + 4
  });

  it("returns a copy — mutations don't affect internal state", () => {
    const session = new Session();
    session.addMessage("user", "Hi");

    const msgs = session.getMessages();
    msgs.push({ role: "assistant", content: "injected" });

    expect(session.getMessages()).toHaveLength(1);
  });
});

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it("getOrCreate creates a new session with system prompt", () => {
    const session = manager.getOrCreate("test", "System prompt");
    const msgs = session.getMessages();
    expect(msgs[0].content).toBe("System prompt");
  });

  it("getOrCreate returns same session on second call", () => {
    const s1 = manager.getOrCreate("test", "prompt");
    s1.addMessage("user", "Hi");

    const s2 = manager.getOrCreate("test", "prompt");
    expect(s2.getMessages()).toHaveLength(2); // system + user
  });

  it("shouldConsolidate returns false under threshold", () => {
    const session = manager.getOrCreate("test", "sys");
    session.addMessage("user", "m1");
    session.addMessage("assistant", "r1");

    expect(manager.shouldConsolidate("test", 5)).toBe(false);
  });

  it("shouldConsolidate returns true at threshold", () => {
    const session = manager.getOrCreate("test", "sys");
    for (let i = 0; i < 5; i++) {
      session.addMessage("user", `msg ${i}`);
      session.addMessage("assistant", `reply ${i}`);
    }

    expect(manager.shouldConsolidate("test", 5)).toBe(true);
  });

  it("markConsolidated resets unconsolidated count", () => {
    const session = manager.getOrCreate("test", "sys");
    for (let i = 0; i < 5; i++) {
      session.addMessage("user", `msg ${i}`);
      session.addMessage("assistant", `reply ${i}`);
    }

    expect(manager.shouldConsolidate("test", 5)).toBe(true);
    manager.markConsolidated("test");
    expect(manager.shouldConsolidate("test", 5)).toBe(false);
  });

  it("getUnconsolidatedMessages returns only new messages after mark", () => {
    const session = manager.getOrCreate("test", "sys");
    session.addMessage("user", "old");
    session.addMessage("assistant", "old reply");
    manager.markConsolidated("test");

    session.addMessage("user", "new");
    session.addMessage("assistant", "new reply");

    const unconsolidated = manager.getUnconsolidatedMessages("test");
    expect(unconsolidated).toHaveLength(2);
    expect(unconsolidated[0].content).toBe("new");
  });

  it("clear removes session", () => {
    manager.getOrCreate("test", "sys");
    manager.clear("test");
    expect(manager.get("test")).toBeUndefined();
  });
});
