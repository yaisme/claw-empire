import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import { createOneShotRunner } from "./one-shot-runner.ts";
import type { AgentRow } from "./conversation-types.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

vi.mock("node:fs", () => {
  const fakeStream = {
    write: vi.fn(),
    end: vi.fn((cb?: () => void) => cb?.()),
    destroyed: false,
    writableEnded: false,
    closed: false,
  };
  return {
    default: {
      createWriteStream: vi.fn(() => fakeStream),
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
    },
  };
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import fs from "node:fs";

const mockedSpawn = vi.mocked(spawn);

function makeAgent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    name: "Test Agent",
    name_ko: "테스트",
    role: "senior",
    personality: null,
    status: "idle",
    department_id: "dept-1",
    current_task_id: null,
    avatar_emoji: "🤖",
    cli_provider: "claude",
    oauth_account_id: null,
    api_provider_id: null,
    api_model: null,
    cli_model: null,
    cli_reasoning_level: null,
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    logsDir: "/tmp/test-logs",
    broadcast: vi.fn(),
    getProviderModelConfig: vi.fn(() => ({})),
    executeApiProviderAgent: vi.fn(async () => {}),
    executeCopilotAgent: vi.fn(async () => {}),
    executeAntigravityAgent: vi.fn(async () => {}),
    killPidTree: vi.fn(),
    prettyStreamJson: vi.fn((raw: string) => raw),
    getPreferredLanguage: vi.fn(() => "en"),
    normalizeStreamChunk: vi.fn((chunk: Buffer | string) => String(chunk)),
    hasStructuredJsonLines: vi.fn(() => false),
    normalizeConversationReply: vi.fn((_raw: string) => ""),
    buildAgentArgs: vi.fn(
      (provider: string) => [provider === "claude" ? "claude" : provider, "--print", "-"],
    ),
    withCliPathFallback: vi.fn((p: string | undefined) => p ?? "/usr/bin"),
    ...overrides,
  };
}

/** Create a fake child process (EventEmitter with stdin/stdout/stderr). */
function fakeChild(pid = 1234) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.pid = pid;
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("createOneShotRunner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Re-apply the fs mock after restoreAllMocks
    const fakeStream = {
      write: vi.fn(),
      end: vi.fn((cb?: () => void) => cb?.()),
      destroyed: false,
      writableEnded: false,
      closed: false,
    };
    vi.mocked(fs.createWriteStream).mockReturnValue(fakeStream as any);
  });

  it("returns an object with runAgentOneShot function", () => {
    const runner = createOneShotRunner(makeDeps() as any);
    expect(runner).toHaveProperty("runAgentOneShot");
    expect(typeof runner.runAgentOneShot).toBe("function");
  });

  /* -------------------------------------------------------------- */
  /*  CLI spawn path (provider = claude / codex / gemini etc.)       */
  /* -------------------------------------------------------------- */
  describe("CLI spawn path", () => {
    it("collects stdout output and returns normalized text", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "Hello from agent"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "Say hello");

      // Simulate stdout data then close
      child.stdout.emit("data", Buffer.from("Hello from agent"));
      child.emit("close", 0);

      const result = await promise;
      expect(result.text).toBe("Hello from agent");
      expect(result.error).toBeUndefined();
    });

    it("collects stderr output alongside stdout", async () => {
      const allChunks: string[] = [];
      const deps = makeDeps({
        normalizeStreamChunk: vi.fn((chunk: Buffer | string) => {
          const text = String(chunk);
          allChunks.push(text);
          return text;
        }),
        normalizeConversationReply: vi.fn(() => "combined"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");

      child.stdout.emit("data", Buffer.from("out"));
      child.stderr.emit("data", Buffer.from("err"));
      child.emit("close", 0);

      await promise;
      expect(allChunks).toContain("out");
      expect(allChunks).toContain("err");
    });

    it("writes prompt to child stdin", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "ok"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const prompt = "What is 2+2?";
      const promise = runner.runAgentOneShot(makeAgent(), prompt);

      child.emit("close", 0);
      await promise;

      expect(child.stdin.write).toHaveBeenCalledWith(prompt);
      expect(child.stdin.end).toHaveBeenCalled();
    });

    it("broadcasts cli_output when streamTaskId is provided", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "ok"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt", {
        streamTaskId: "task-42",
      });

      child.stdout.emit("data", Buffer.from("chunk"));
      child.emit("close", 0);

      await promise;
      expect(deps.broadcast).toHaveBeenCalledWith("cli_output", {
        task_id: "task-42",
        stream: "stdout",
        data: "chunk",
      });
    });

    it("returns error text when child exits with non-zero and no output", async () => {
      const deps = makeDeps();
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");

      // normalizeStreamChunk returns empty string => no rawOutput
      vi.mocked(deps.normalizeStreamChunk as any).mockReturnValue("");
      child.emit("close", 1);

      const result = await promise;
      expect(result.error).toContain("exited with code 1");
    });

    it("returns rawOutput when opts.rawOutput is true", async () => {
      const deps = makeDeps({
        prettyStreamJson: vi.fn(() => ""),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt", {
        rawOutput: true,
      });

      child.stdout.emit("data", Buffer.from("raw text here"));
      child.emit("close", 0);

      const result = await promise;
      expect(result.text).toBe("raw text here");
    });
  });

  /* -------------------------------------------------------------- */
  /*  Timeout handling                                               */
  /* -------------------------------------------------------------- */
  describe("timeout handling", () => {
    it("rejects and kills child on timeout", async () => {
      vi.useFakeTimers();
      const deps = makeDeps({
        prettyStreamJson: vi.fn(() => ""),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild(9999);
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "slow prompt", {
        timeoutMs: 5000,
      });

      // Advance past timeout
      vi.advanceTimersByTime(6000);

      const result = await promise;
      // After timeout the error catch branch returns { text, error }
      expect(result.error).toContain("timeout");
      expect(deps.killPidTree).toHaveBeenCalledWith(9999);

      vi.useRealTimers();
    });

    it("uses default timeout of 180s when none provided", async () => {
      vi.useFakeTimers();
      const deps = makeDeps({
        prettyStreamJson: vi.fn(() => ""),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild(5555);
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");

      // 179s should not trigger timeout
      vi.advanceTimersByTime(179_000);
      expect(deps.killPidTree).not.toHaveBeenCalled();

      // 181s should trigger timeout
      vi.advanceTimersByTime(2_000);
      const result = await promise;
      expect(result.error).toContain("timeout");
      expect(deps.killPidTree).toHaveBeenCalledWith(5555);

      vi.useRealTimers();
    });
  });

  /* -------------------------------------------------------------- */
  /*  Cleanup / detach behavior                                      */
  /* -------------------------------------------------------------- */
  describe("cleanup behavior", () => {
    it("calls safeEnd on the log stream after run completes", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "done"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");
      child.emit("close", 0);

      await promise;

      // The mocked fs.createWriteStream returns an object whose end() should be called
      const stream = vi.mocked(fs.createWriteStream).mock.results[0]?.value;
      expect(stream.end).toHaveBeenCalled();
    });

    it("handles child process error event gracefully", async () => {
      const deps = makeDeps({
        prettyStreamJson: vi.fn(() => ""),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");

      child.emit("error", new Error("ENOENT: command not found"));

      const result = await promise;
      expect(result.error).toContain("ENOENT");
    });
  });

  /* -------------------------------------------------------------- */
  /*  noTools policy enforcement                                     */
  /* -------------------------------------------------------------- */
  describe("noTools policy", () => {
    it("aborts run when tool_use signal detected with noTools=true", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "partial answer"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild(7777);
      mockedSpawn.mockReturnValue(child as any);

      const promise = runner.runAgentOneShot(makeAgent(), "prompt", {
        noTools: true,
      });

      // Emit output that contains a tool_use signal
      child.stdout.emit(
        "data",
        Buffer.from('{"type": "tool_use", "name": "bash"}'),
      );

      const result = await promise;
      // Should return partial text without an error field (no-tools violation
      // goes through the NO_TOOLS_POLICY_ERROR branch which does not set error)
      expect(result.text).toBe("partial answer");
      expect(result.error).toBeUndefined();
      expect(deps.killPidTree).toHaveBeenCalledWith(7777);
    });
  });

  /* -------------------------------------------------------------- */
  /*  API provider path                                              */
  /* -------------------------------------------------------------- */
  describe("api provider path", () => {
    it("delegates to executeApiProviderAgent", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "api response"),
      });
      const runner = createOneShotRunner(deps as any);

      const agent = makeAgent({ cli_provider: "api" });
      const result = await runner.runAgentOneShot(agent, "api prompt");

      expect(deps.executeApiProviderAgent).toHaveBeenCalled();
      expect(result.text).toBe("api response");
    });

    it("returns error when api provider throws", async () => {
      const deps = makeDeps({
        executeApiProviderAgent: vi.fn(async () => {
          throw new Error("API key invalid");
        }),
        prettyStreamJson: vi.fn(() => ""),
      });
      const runner = createOneShotRunner(deps as any);

      const agent = makeAgent({ cli_provider: "api" });
      const result = await runner.runAgentOneShot(agent, "prompt");

      expect(result.error).toContain("API key invalid");
    });
  });

  /* -------------------------------------------------------------- */
  /*  Copilot / Antigravity paths                                    */
  /* -------------------------------------------------------------- */
  describe("copilot provider path", () => {
    it("delegates to executeCopilotAgent", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "copilot reply"),
      });
      const runner = createOneShotRunner(deps as any);

      const agent = makeAgent({ cli_provider: "copilot" });
      const result = await runner.runAgentOneShot(agent, "copilot prompt");

      expect(deps.executeCopilotAgent).toHaveBeenCalled();
      expect(result.text).toBe("copilot reply");
    });
  });

  describe("antigravity provider path", () => {
    it("delegates to executeAntigravityAgent", async () => {
      const deps = makeDeps({
        normalizeConversationReply: vi.fn(() => "antigravity reply"),
      });
      const runner = createOneShotRunner(deps as any);

      const agent = makeAgent({ cli_provider: "antigravity" });
      const result = await runner.runAgentOneShot(agent, "antigravity prompt");

      expect(deps.executeAntigravityAgent).toHaveBeenCalled();
      expect(result.text).toBe("antigravity reply");
    });
  });

  /* -------------------------------------------------------------- */
  /*  Fallback language behavior                                     */
  /* -------------------------------------------------------------- */
  describe("fallback text when no output", () => {
    it("returns English fallback when language is en", async () => {
      const deps = makeDeps({
        getPreferredLanguage: vi.fn(() => "en"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);
      vi.mocked(deps.normalizeStreamChunk as any).mockReturnValue("");

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");
      child.emit("close", 0);

      const result = await promise;
      expect(result.text).toContain("Acknowledged");
    });

    it("returns Korean fallback when language is ko", async () => {
      const deps = makeDeps({
        getPreferredLanguage: vi.fn(() => "ko"),
      });
      const runner = createOneShotRunner(deps as any);

      const child = fakeChild();
      mockedSpawn.mockReturnValue(child as any);
      vi.mocked(deps.normalizeStreamChunk as any).mockReturnValue("");

      const promise = runner.runAgentOneShot(makeAgent(), "prompt");
      child.emit("close", 0);

      const result = await promise;
      expect(result.text).toContain("확인했습니다");
    });
  });
});
