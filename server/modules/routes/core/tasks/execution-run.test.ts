import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskRunRouteDeps } from "./execution-run.ts";
import { registerTaskRunRoute } from "./execution-run.ts";

// ---------------------------------------------------------------------------
// Mock external modules that the handler imports
// ---------------------------------------------------------------------------
vi.mock("../../../../gateway/client.ts", () => ({
  notifyTaskStatus: vi.fn(),
}));
vi.mock("./execution-run-auto-assign.ts", () => ({
  resolveConstrainedAgentScopeForTask: vi.fn(() => null),
  selectAutoAssignableAgentForTask: vi.fn(() => null),
}));
vi.mock("../../../workflow/packs/execution-guidance.ts", () => ({
  buildWorkflowPackExecutionGuidance: vi.fn(() => ""),
}));
vi.mock("../../../workflow/packs/video-artifact.ts", () => ({
  resolveVideoArtifactSpecForTask: vi.fn(() => null),
}));
vi.mock("../../../workflow/core/video-skill-bootstrap.ts", () => ({
  ensureVideoPreprodRemotionBestPracticesSkill: vi.fn(),
}));
vi.mock("../../../workflow/core/interrupt-injection-tools.ts", () => ({
  buildInterruptPromptBlock: vi.fn(() => ""),
  consumeInterruptPrompts: vi.fn(),
  loadPendingInterruptPrompts: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  assigned_agent_id: string | null;
  department_id: string | null;
  project_id: string | null;
  workflow_pack_key: string | null;
  project_path: string | null;
  status: string;
  started_at?: number | null;
  updated_at?: number;
};

type AgentRow = {
  id: string;
  name: string;
  name_ko: string | null;
  role: string;
  cli_provider: string | null;
  oauth_account_id: string | null;
  api_provider_id: string | null;
  api_model: string | null;
  cli_model: string | null;
  cli_reasoning_level: string | null;
  personality: string | null;
  department_id: string | null;
  department_name: string | null;
  department_name_ko: string | null;
  department_prompt: string | null;
  status: string;
  current_task_id: string | null;
};

type FakeDbState = {
  tasks: Map<string, TaskRow>;
  agents: Map<string, AgentRow>;
};

type FakeRes = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => FakeRes;
  json: (body: unknown) => FakeRes;
};

function createFakeRes(): FakeRes {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
      return this;
    },
  };
}

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------
function createFakeDb(state: FakeDbState) {
  return {
    prepare(sql: string) {
      if (sql.startsWith("SELECT * FROM tasks WHERE id = ?")) {
        return {
          get: (id: string) => state.tasks.get(id),
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      if (sql.includes("SELECT current_task_id FROM agents WHERE id = ? AND status = 'working'")) {
        return {
          get: (agentId: string) => {
            const agent = state.agents.get(agentId);
            if (!agent || agent.status !== "working") return undefined;
            return { current_task_id: agent.current_task_id };
          },
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      if (sql.includes("FROM agents a")) {
        // Agent lookup with department join
        return {
          get: (_packKey: any, agentId: string) => state.agents.get(agentId),
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      if (sql.startsWith("SELECT * FROM agents WHERE id = ?")) {
        return {
          get: (agentId: string) => state.agents.get(agentId),
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      if (sql.startsWith("UPDATE tasks SET status = 'in_progress'")) {
        return {
          run: (agentId: string, startedAt: number, updatedAt: number, id: string) => {
            const row = state.tasks.get(id);
            if (!row) return { changes: 0 };
            state.tasks.set(id, {
              ...row,
              status: "in_progress",
              assigned_agent_id: agentId,
              started_at: startedAt,
              updated_at: updatedAt,
            });
            return { changes: 1 };
          },
          get: () => undefined,
          all: () => [],
        };
      }
      if (sql.startsWith("UPDATE tasks SET status = 'pending'")) {
        return {
          run: (updatedAt: number, id: string) => {
            const row = state.tasks.get(id);
            if (!row) return { changes: 0 };
            state.tasks.set(id, { ...row, status: "pending", updated_at: updatedAt });
            return { changes: 1 };
          },
          get: () => undefined,
          all: () => [],
        };
      }
      if (sql.startsWith("UPDATE agents SET status = 'working'")) {
        return {
          run: (taskId: string, agentId: string) => {
            const agent = state.agents.get(agentId);
            if (!agent) return { changes: 0 };
            state.agents.set(agentId, { ...agent, status: "working", current_task_id: taskId });
            return { changes: 1 };
          },
          get: () => undefined,
          all: () => [],
        };
      }
      if (sql.startsWith("SELECT department_id FROM tasks WHERE id = ?")) {
        return {
          get: (id: string) => {
            const row = state.tasks.get(id);
            if (!row) return undefined;
            return { department_id: row.department_id };
          },
          all: () => [],
          run: () => ({ changes: 0 }),
        };
      }
      // Default fallback
      return {
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 0 }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
function createHarness(seed?: {
  task?: Partial<TaskRow>;
  agent?: Partial<AgentRow>;
  activePid?: number | null;
  worktreeResult?: string | null;
}) {
  const taskId = "task-1";
  const agentId = "agent-1";

  const state: FakeDbState = {
    tasks: new Map([
      [
        taskId,
        {
          id: taskId,
          title: "Test task",
          description: "Do something",
          assigned_agent_id: agentId,
          department_id: "eng",
          project_id: null,
          workflow_pack_key: null,
          project_path: null,
          status: "planned",
          ...seed?.task,
        },
      ],
    ]),
    agents: new Map([
      [
        agentId,
        {
          id: agentId,
          name: "Alice",
          name_ko: null,
          role: "senior",
          cli_provider: "claude",
          oauth_account_id: null,
          api_provider_id: null,
          api_model: null,
          cli_model: null,
          cli_reasoning_level: null,
          personality: null,
          department_id: "eng",
          department_name: "Engineering",
          department_name_ko: null,
          department_prompt: null,
          status: "idle",
          current_task_id: null,
          ...seed?.agent,
        },
      ],
    ]),
  };

  const routes = new Map<string, (req: any, res: any) => any>();
  const app = {
    post(path: string, handler: (req: any, res: any) => any) {
      routes.set(path, handler);
    },
  };

  const activeProcesses = new Map<string, { pid: number; kill: () => void }>();
  if (typeof seed?.activePid === "number") {
    activeProcesses.set(taskId, { pid: seed.activePid, kill: vi.fn() });
  }

  const appendTaskLog = vi.fn();
  const broadcast = vi.fn();
  const notifyCeo = vi.fn();
  const resolveProjectPath = vi.fn(() => "/projects/my-app");
  const createWorktree = vi.fn(() => seed?.worktreeResult !== undefined ? seed.worktreeResult : "/tmp/worktree/task-1");
  const spawnCliAgent = vi.fn(() => {
    const emitter = { on: vi.fn(), pid: 12345 };
    return emitter;
  });

  const deps: TaskRunRouteDeps = {
    app: app as any,
    db: createFakeDb(state) as any,
    activeProcesses: activeProcesses as any,
    appendTaskLog,
    nowMs: () => 100000,
    resolveLang: () => "en",
    ensureTaskExecutionSession: vi.fn(() => ({
      sessionId: "session-1",
      agentId,
      provider: "claude",
    })),
    resolveProjectPath,
    logsDir: "/tmp/logs",
    createWorktree,
    generateProjectContext: vi.fn(() => "src/\n  index.ts"),
    getRecentChanges: vi.fn(() => ""),
    ensureClaudeMd: vi.fn(),
    getDeptRoleConstraint: vi.fn(() => ""),
    normalizeTextField: vi.fn((text: string | null) => text ?? ""),
    getRecentConversationContext: vi.fn(() => ""),
    getTaskContinuationContext: vi.fn(() => ""),
    pickL: vi.fn((bundle: any, _lang: string) => {
      if (Array.isArray(bundle)) return bundle[0];
      return bundle?.en?.[0] ?? bundle?.ko?.[0] ?? "";
    }),
    l: vi.fn((_ko: string[], en: string[]) => ({ en })),
    getProviderModelConfig: vi.fn(() => ({})),
    buildTaskExecutionPrompt: vi.fn(() => "prompt-text"),
    hasExplicitWarningFixRequest: vi.fn(() => false),
    getNextHttpAgentPid: vi.fn(() => 99999),
    broadcast,
    getAgentDisplayName: vi.fn(() => "Alice"),
    notifyCeo,
    startProgressTimer: vi.fn(),
    launchApiProviderAgent: vi.fn(),
    launchHttpAgent: vi.fn(),
    spawnCliAgent,
    handleTaskRunComplete: vi.fn(),
    buildAvailableSkillsPromptBlock: vi.fn(() => "[skills]"),
  };

  return {
    deps,
    routes,
    state,
    activeProcesses,
    spies: {
      appendTaskLog,
      broadcast,
      notifyCeo,
      resolveProjectPath,
      createWorktree,
      spawnCliAgent,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("registerTaskRunRoute", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 404 when the task does not exist", () => {
    const harness = createHarness();
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run");
    expect(handler).toBeTypeOf("function");

    const req = { params: { id: "nonexistent" }, body: {} };
    const res = createFakeRes();
    handler!(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toMatchObject({ error: "not_found" });
  });

  it("returns 400 when the agent is not found", () => {
    const harness = createHarness({
      task: { assigned_agent_id: "agent-missing" },
    });
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ error: "agent_not_found" });
  });

  it("returns 400 (agent_busy) when the agent is already working on another task", () => {
    const harness = createHarness({
      agent: { status: "working", current_task_id: "other-task" },
    });
    // Put "other-task" into activeProcesses so the busy check passes
    harness.activeProcesses.set("other-task", { pid: 7777, kill: vi.fn() });
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ error: "agent_busy" });
  });

  it("returns 400 for an unsupported CLI provider", () => {
    const harness = createHarness({
      agent: { cli_provider: "unknown_provider" },
    });
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload).toMatchObject({ error: "unsupported_provider", provider: "unknown_provider" });
  });

  it("returns 409 (worktree_required) when worktree creation fails", () => {
    const harness = createHarness({ worktreeResult: null });
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.payload).toMatchObject({ error: "worktree_required" });
    expect(harness.spies.appendTaskLog).toHaveBeenCalledWith(
      "task-1",
      "error",
      expect.stringContaining("worktree creation failed"),
    );
  });

  it("updates task to in_progress and agent to working on successful run", () => {
    const harness = createHarness();
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, pid: 12345, worktree: true });

    // Task status should have been updated to in_progress
    const updatedTask = harness.state.tasks.get("task-1");
    expect(updatedTask?.status).toBe("in_progress");
    expect(updatedTask?.assigned_agent_id).toBe("agent-1");

    // Agent should be working
    const updatedAgent = harness.state.agents.get("agent-1");
    expect(updatedAgent?.status).toBe("working");
    expect(updatedAgent?.current_task_id).toBe("task-1");

    // broadcast should have been called for both task and agent updates
    expect(harness.spies.broadcast).toHaveBeenCalledWith("task_update", expect.anything());
    expect(harness.spies.broadcast).toHaveBeenCalledWith("agent_status", expect.anything());
  });

  it("resolves projectPath to absolute via path.resolve", () => {
    const harness = createHarness();
    // Return a relative path to verify it gets resolved
    (harness.deps.resolveProjectPath as ReturnType<typeof vi.fn>).mockReturnValue("relative/project");
    registerTaskRunRoute(harness.deps);

    const handler = harness.routes.get("/api/tasks/:id/run")!;
    const req = { params: { id: "task-1" }, body: {} };
    const res = createFakeRes();
    handler(req, res);

    // createWorktree should have been called with an absolute path (not relative)
    const calledPath = (harness.spies.createWorktree.mock.calls as unknown[][])[0]?.[0] as string;
    expect(calledPath).toBeDefined();
    // path.resolve converts relative paths to absolute (starts with /)
    expect(calledPath.startsWith("/")).toBe(true);
    expect(calledPath).not.toBe("relative/project");
  });
});
