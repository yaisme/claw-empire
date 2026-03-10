import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applyTaskSchemaMigrations } from "./task-schema-migrations.ts";

function createFreshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // Minimal base schema required by migrations
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '🏢',
      color TEXT NOT NULL DEFAULT '#64748b',
      description TEXT,
      prompt TEXT,
      sort_order INTEGER NOT NULL DEFAULT 99,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      department_id TEXT REFERENCES departments(id),
      role TEXT NOT NULL CHECK(role IN ('team_leader','senior','junior','intern')),
      cli_provider TEXT,
      oauth_account_id TEXT,
      api_provider_id TEXT,
      api_model TEXT,
      cli_model TEXT,
      cli_reasoning_level TEXT,
      avatar_emoji TEXT NOT NULL DEFAULT '🤖',
      sprite_number INTEGER,
      personality TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      stats_tasks_done INTEGER DEFAULT 0,
      stats_xp INTEGER DEFAULT 0,
      acts_as_planning_leader INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_path TEXT NOT NULL,
      core_goal TEXT NOT NULL,
      last_used_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      department_id TEXT REFERENCES departments(id),
      assigned_agent_id TEXT REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'inbox'
        CHECK(status IN ('inbox','planned','in_progress','review','done','cancelled')),
      priority INTEGER DEFAULT 0,
      task_type TEXT DEFAULT 'general',
      project_path TEXT,
      result TEXT,
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      updated_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      assigned_agent_id TEXT,
      blocked_reason TEXT,
      cli_tool_use_id TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000),
      completed_at INTEGER
    );
    CREATE TABLE task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT REFERENCES tasks(id),
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      sender_type TEXT NOT NULL CHECK(sender_type IN ('ceo','agent','system')),
      sender_id TEXT,
      receiver_type TEXT NOT NULL CHECK(receiver_type IN ('agent','department','all')),
      receiver_id TEXT,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'chat' CHECK(message_type IN ('chat','task_assign','announcement','directive','report','status_update')),
      task_id TEXT REFERENCES tasks(id),
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE task_creation_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      source TEXT,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE meeting_minutes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      meeting_type TEXT NOT NULL CHECK(meeting_type IN ('planned','review')),
      round INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'in_progress',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
    CREATE TABLE meeting_minute_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT NOT NULL REFERENCES meeting_minutes(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      speaker_agent_id TEXT,
      speaker_name TEXT NOT NULL,
      department_name TEXT,
      role_label TEXT,
      message_type TEXT NOT NULL DEFAULT 'chat',
      content TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()*1000)
    );
  `);
  return db;
}

function getColumnNames(db: DatabaseSync, table: string): string[] {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.map((c) => c.name);
}

function getTableNames(db: DatabaseSync): string[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return tables.map((t) => t.name);
}

function getIndexNames(db: DatabaseSync): string[] {
  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return indexes.map((i) => i.name);
}

describe("applyTaskSchemaMigrations", () => {
  it("runs without error on fresh database", () => {
    const db = createFreshDb();
    expect(() => applyTaskSchemaMigrations(db)).not.toThrow();
  });

  it("is idempotent — running twice does not error", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    expect(() => applyTaskSchemaMigrations(db)).not.toThrow();
  });

  it("adds cross-department columns to subtasks", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "subtasks");
    expect(cols).toContain("target_department_id");
    expect(cols).toContain("delegated_task_id");
  });

  it("adds source_task_id column to tasks", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "tasks");
    expect(cols).toContain("source_task_id");
  });

  it("adds project_id column to tasks", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "tasks");
    expect(cols).toContain("project_id");
  });

  it("adds hidden column to tasks", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "tasks");
    expect(cols).toContain("hidden");
  });

  it("adds workflow_pack_key and workflow_meta_json to tasks", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "tasks");
    expect(cols).toContain("workflow_pack_key");
    expect(cols).toContain("workflow_meta_json");
    expect(cols).toContain("output_format");
  });

  it("adds completed column to task_creation_audits", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "task_creation_audits");
    expect(cols).toContain("completed");
  });

  it("creates task_interrupt_injections table", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const tables = getTableNames(db);
    expect(tables).toContain("task_interrupt_injections");

    const cols = getColumnNames(db, "task_interrupt_injections");
    expect(cols).toContain("task_id");
    expect(cols).toContain("session_id");
    expect(cols).toContain("prompt_text");
    expect(cols).toContain("prompt_hash");
    expect(cols).toContain("consumed_at");
  });

  it("creates project_agents table", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const tables = getTableNames(db);
    expect(tables).toContain("project_agents");

    const cols = getColumnNames(db, "project_agents");
    expect(cols).toContain("project_id");
    expect(cols).toContain("agent_id");
  });

  it("adds assignment_mode and default_pack_key to projects", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "projects");
    expect(cols).toContain("assignment_mode");
    expect(cols).toContain("default_pack_key");
  });

  it("creates office_pack_departments table", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const tables = getTableNames(db);
    expect(tables).toContain("office_pack_departments");
  });

  it("adds workflow_pack_key to agents", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "agents");
    expect(cols).toContain("workflow_pack_key");
  });

  it("creates expected indexes", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const indexes = getIndexNames(db);
    expect(indexes).toContain("idx_tasks_project");
    expect(indexes).toContain("idx_tasks_workflow_pack");
    expect(indexes).toContain("idx_task_interrupt_injections_task");
    expect(indexes).toContain("idx_project_agents_project");
    expect(indexes).toContain("idx_agents_workflow_pack");
    expect(indexes).toContain("idx_office_pack_departments_pack_sort");
  });

  it("adds idempotency_key to messages and creates unique index", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    const cols = getColumnNames(db, "messages");
    expect(cols).toContain("idempotency_key");
    const indexes = getIndexNames(db);
    expect(indexes).toContain("idx_messages_idempotency_key");
  });

  it("migrates tasks status CHECK to include collaborating and pending", () => {
    const db = createFreshDb();
    applyTaskSchemaMigrations(db);
    // After migration, should accept 'collaborating' and 'pending' status
    db.prepare("INSERT INTO tasks (id, title, status) VALUES ('t1', 'test', 'collaborating')").run();
    db.prepare("INSERT INTO tasks (id, title, status) VALUES ('t2', 'test2', 'pending')").run();
    const rows = db.prepare("SELECT status FROM tasks WHERE id IN ('t1','t2') ORDER BY id").all() as Array<{
      status: string;
    }>;
    expect(rows.map((r) => r.status)).toEqual(["collaborating", "pending"]);
  });
});
