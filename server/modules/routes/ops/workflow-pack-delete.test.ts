import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { registerWorkflowPackRoutes } from "./workflow-packs.ts";

type RouteHandler = (req: any, res: any) => any;

type FakeResponse = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
};

function createFakeResponse(): FakeResponse {
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

function createHarness() {
  const db = new DatabaseSync(":memory:");

  // Minimal schema matching base-schema.ts
  db.exec(`
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '📁',
      color TEXT NOT NULL DEFAULT '#888',
      description TEXT,
      prompt TEXT,
      sort_order INTEGER NOT NULL DEFAULT 99,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE office_pack_departments (
      workflow_pack_key TEXT NOT NULL,
      department_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '📁',
      color TEXT NOT NULL DEFAULT '#888',
      description TEXT,
      prompt TEXT,
      sort_order INTEGER NOT NULL DEFAULT 99,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      PRIMARY KEY (workflow_pack_key, department_id)
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      department_id TEXT,
      workflow_pack_key TEXT NOT NULL DEFAULT 'development',
      role TEXT NOT NULL DEFAULT 'junior',
      acts_as_planning_leader INTEGER NOT NULL DEFAULT 0,
      cli_provider TEXT,
      avatar_emoji TEXT NOT NULL DEFAULT '🤖',
      sprite_number INTEGER,
      personality TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      stats_tasks_done INTEGER DEFAULT 0,
      stats_xp INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL DEFAULT '/tmp',
      core_goal TEXT NOT NULL DEFAULT '',
      default_pack_key TEXT NOT NULL DEFAULT 'development',
      last_used_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE workflow_packs (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      input_schema_json TEXT NOT NULL DEFAULT '{}',
      prompt_preset_json TEXT NOT NULL DEFAULT '{}',
      qa_rules_json TEXT NOT NULL DEFAULT '{}',
      output_template_json TEXT NOT NULL DEFAULT '{}',
      routing_keywords_json TEXT NOT NULL DEFAULT '[]',
      cost_profile_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      department_id TEXT,
      assigned_agent_id TEXT,
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'inbox',
      priority INTEGER DEFAULT 0,
      task_type TEXT DEFAULT 'general',
      workflow_pack_key TEXT NOT NULL DEFAULT 'development',
      workflow_meta_json TEXT,
      output_format TEXT,
      project_path TEXT,
      base_branch TEXT,
      result TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      source_task_id TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_agent_id TEXT,
      blocked_reason TEXT,
      delegated_task_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE meeting_minute_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      speaker_agent_id TEXT,
      content TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE task_report_archives (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      generated_by_agent_id TEXT,
      content TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE review_round_decision_states (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      planner_agent_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const routes = new Map<string, RouteHandler>();
  const app = {
    get(path: string, handler: RouteHandler) {
      routes.set(`GET ${path}`, handler);
      return this;
    },
    post(path: string, handler: RouteHandler) {
      routes.set(`POST ${path}`, handler);
      return this;
    },
    put(path: string, handler: RouteHandler) {
      routes.set(`PUT ${path}`, handler);
      return this;
    },
    delete(path: string, handler: RouteHandler) {
      routes.set(`DELETE ${path}`, handler);
      return this;
    },
  };

  registerWorkflowPackRoutes({
    app: app as any,
    db: db as any,
    nowMs: () => Date.now(),
    normalizeTextField: (v: any) => (typeof v === "string" ? v.trim() : ""),
  });

  return { db, routes };
}

function seedTestPack(db: DatabaseSync, key: string, name: string) {
  db.prepare(
    `INSERT INTO workflow_packs (key, name) VALUES (?, ?)`,
  ).run(key, name);
}

function seedAgent(db: DatabaseSync, id: string, packKey: string, deptId: string | null = null) {
  db.prepare(
    `INSERT INTO agents (id, name, workflow_pack_key, department_id) VALUES (?, ?, ?, ?)`,
  ).run(id, `Agent ${id}`, packKey, deptId);
}

function seedTask(db: DatabaseSync, id: string, packKey: string, status = "done", agentId: string | null = null) {
  db.prepare(
    `INSERT INTO tasks (id, title, status, workflow_pack_key, assigned_agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, `Task ${id}`, status, packKey, agentId, Date.now(), Date.now());
}

function countRows(db: DatabaseSync, table: string, where = ""): number {
  const sql = `SELECT COUNT(*) AS cnt FROM ${table}${where ? ` WHERE ${where}` : ""}`;
  return (db.prepare(sql).get() as { cnt: number }).cnt;
}

describe("DELETE /api/workflow-packs/:key — cascade behavior", () => {
  it("cannot delete the development pack", () => {
    const { routes } = createHarness();
    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "development" }, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect((res.payload as any).error).toBe("cannot_delete_default");
  });

  it("returns 404 for non-existent pack", () => {
    const { routes } = createHarness();
    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "nonexistent" }, query: {} }, res);
    expect(res.statusCode).toBe(404);
  });

  it("blocks deletion when active tasks exist without force", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    seedTask(db, "t1", "novel", "in_progress");

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);
    expect(res.statusCode).toBe(409);
    expect((res.payload as any).error).toBe("active_tasks_exist");
  });

  it("with agentAction=reassign (default): detaches agents but does NOT delete them", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    seedAgent(db, "a1", "novel", "dept-1");
    seedAgent(db, "a2", "novel", "dept-2");
    seedAgent(db, "a3", "development"); // unrelated agent

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect((res.payload as any).ok).toBe(true);

    // Pack is gone
    expect(countRows(db, "workflow_packs", "key = 'novel'")).toBe(0);

    // Agents still exist but are reassigned to development (NOT NULL constraint)
    expect(countRows(db, "agents")).toBe(3);
    const a1 = db.prepare("SELECT workflow_pack_key, department_id FROM agents WHERE id = 'a1'").get() as any;
    expect(a1.workflow_pack_key).toBe("development");
    expect(a1.department_id).toBeNull();

    // Unrelated agent untouched
    const a3 = db.prepare("SELECT workflow_pack_key FROM agents WHERE id = 'a3'").get() as any;
    expect(a3.workflow_pack_key).toBe("development");
  });

  it("with agentAction=delete: removes agents entirely", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    seedAgent(db, "a1", "novel");
    seedAgent(db, "a2", "novel");
    seedAgent(db, "a3", "development");

    // Agent a1 has FK references in tasks and subtasks
    seedTask(db, "t1", "novel", "done", "a1");
    db.prepare("INSERT INTO subtasks (id, task_id, assigned_agent_id) VALUES ('s1', 't1', 'a1')").run();
    db.prepare("INSERT INTO meeting_minute_entries (id, task_id, speaker_agent_id) VALUES ('m1', 't1', 'a1')").run();

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: { agentAction: "delete" } }, res);

    expect(res.statusCode).toBe(200);

    // Novel agents are deleted
    expect(countRows(db, "agents", "workflow_pack_key = 'novel'")).toBe(0);
    // Unrelated agent survives
    expect(countRows(db, "agents")).toBe(1);

    // FK references are nullified
    const t1 = db.prepare("SELECT assigned_agent_id FROM tasks WHERE id = 't1'").get() as any;
    expect(t1.assigned_agent_id).toBeNull();
    const s1 = db.prepare("SELECT assigned_agent_id FROM subtasks WHERE id = 's1'").get() as any;
    expect(s1.assigned_agent_id).toBeNull();
    const m1 = db.prepare("SELECT speaker_agent_id FROM meeting_minute_entries WHERE id = 'm1'").get() as any;
    expect(m1.speaker_agent_id).toBeNull();
  });

  it("reverts active office pack to development when deleted pack was active", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    db.prepare("INSERT INTO settings (key, value) VALUES ('officeWorkflowPack', 'novel')").run();

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);

    // Setting reverted to development
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'officeWorkflowPack'").get() as any;
    expect(setting.value).toBe("development");
  });

  it("nullifies task workflow_pack_key for all tasks of the deleted pack", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    seedTask(db, "t1", "novel", "done");
    seedTask(db, "t2", "novel", "inbox");
    seedTask(db, "t3", "development", "done"); // unrelated

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);

    // Novel tasks reassigned to development
    const t1 = db.prepare("SELECT workflow_pack_key FROM tasks WHERE id = 't1'").get() as any;
    expect(t1.workflow_pack_key).toBe("development");

    // Unrelated task untouched
    const t3 = db.prepare("SELECT workflow_pack_key FROM tasks WHERE id = 't3'").get() as any;
    expect(t3.workflow_pack_key).toBe("development");
  });

  it("force=true cancels active tasks and deletes pack", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    seedTask(db, "t1", "novel", "in_progress");
    seedTask(db, "t2", "novel", "review");
    seedTask(db, "t3", "novel", "done");

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: { force: "1" } }, res);

    expect(res.statusCode).toBe(200);

    // Active tasks cancelled
    const t1 = db.prepare("SELECT status FROM tasks WHERE id = 't1'").get() as any;
    expect(t1.status).toBe("cancelled");
    const t2 = db.prepare("SELECT status FROM tasks WHERE id = 't2'").get() as any;
    expect(t2.status).toBe("cancelled");
    // Non-active task status unchanged
    const t3 = db.prepare("SELECT status FROM tasks WHERE id = 't3'").get() as any;
    expect(t3.status).toBe("done");
  });

  it("removes office_pack_departments for the deleted pack", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    db.prepare(
      "INSERT INTO office_pack_departments (workflow_pack_key, department_id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("novel", "dept-1", "Writing", "작문부", "✍️", "#f00");
    db.prepare(
      "INSERT INTO office_pack_departments (workflow_pack_key, department_id, name, name_ko, icon, color) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("novel", "dept-2", "Editing", "편집부", "📝", "#0f0");

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(countRows(db, "office_pack_departments", "workflow_pack_key = 'novel'")).toBe(0);
  });

  it("nullifies project default_pack_key when pack is deleted", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    db.prepare(
      "INSERT INTO projects (id, name, core_goal, default_pack_key) VALUES ('p1', 'My Novel', 'Write a novel', 'novel')",
    ).run();

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);
    const p1 = db.prepare("SELECT default_pack_key FROM projects WHERE id = 'p1'").get() as any;
    expect(p1.default_pack_key).toBe("development");
  });

  it("removes pack from officePackProfiles setting", () => {
    const { db, routes } = createHarness();
    seedTestPack(db, "novel", "Novel Office");
    const profiles = JSON.stringify({
      novel: { agents: [], departments: [] },
      development: { agents: [], departments: [] },
    });
    db.prepare("INSERT INTO settings (key, value) VALUES ('officePackProfiles', ?)").run(profiles);

    const handler = routes.get("DELETE /api/workflow-packs/:key")!;
    const res = createFakeResponse();
    handler({ params: { key: "novel" }, query: {} }, res);

    expect(res.statusCode).toBe(200);
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'officePackProfiles'").get() as any;
    const parsed = JSON.parse(setting.value);
    expect(parsed).not.toHaveProperty("novel");
    expect(parsed).toHaveProperty("development");
  });
});

describe("Office pack dropdown vs DB pack list — known gap", () => {
  it("listOfficePackOptions returns hardcoded PACK_PRESETS, not DB contents", async () => {
    // This is a frontend-only function — import and verify it returns a static list
    const { listOfficePackOptions } = await import("../../../../src/app/office-workflow-pack.ts");

    const options = listOfficePackOptions("en");

    // Should always return the same 6 built-in packs regardless of DB state
    const keys = options.map((o: any) => o.key);
    expect(keys).toContain("development");
    expect(keys).toContain("novel");
    expect(keys).toContain("report");
    expect(keys).toContain("video_preprod");
    expect(keys).toContain("web_research_report");
    expect(keys).toContain("roleplay");

    // This demonstrates the bug: the dropdown never reflects DB deletions
    // because it reads from a hardcoded constant, not from the server
    expect(keys.length).toBe(6);
  });
});
