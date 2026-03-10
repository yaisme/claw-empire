import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { initializeCollabCoordination } from "./coordination.ts";

function setupDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT,
      core_goal TEXT,
      project_path TEXT,
      default_pack_key TEXT NOT NULL DEFAULT 'development',
      last_used_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      department_id TEXT,
      assigned_agent_id TEXT,
      project_id TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      workflow_pack_key TEXT NOT NULL,
      project_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL,
      personality TEXT,
      status TEXT NOT NULL,
      department_id TEXT,
      current_task_id TEXT,
      avatar_emoji TEXT NOT NULL DEFAULT '',
      cli_provider TEXT,
      oauth_account_id TEXT,
      api_provider_id TEXT,
      api_model TEXT,
      cli_model TEXT,
      cli_reasoning_level TEXT
    );

    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ko TEXT NOT NULL DEFAULT '',
      name_ja TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      agent_id TEXT,
      log_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE subtasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT NOT NULL,
      child_task_id TEXT NOT NULL,
      relation_type TEXT NOT NULL DEFAULT 'delegation',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE cross_dept_queue (
      id TEXT PRIMARY KEY,
      source_task_id TEXT NOT NULL,
      target_dept_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT,
      receiver_id TEXT,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'chat',
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

function createMinimalCtx(db: DatabaseSync): any {
  const noop = () => {};
  const noopAsync = async () => {};
  return {
    db: db as any,
    appendTaskLog: noop,
    broadcast: noop,
    buildTaskExecutionPrompt: noopAsync,
    buildAvailableSkillsPromptBlock: () => "",
    crossDeptNextCallbacks: new Map(),
    delegatedTaskToSubtask: new Map(),
    ensureTaskExecutionSession: noop,
    findBestSubordinate: () => null,
    findTeamLeader: () => null,
    getAgentDisplayName: () => "Agent",
    getDeptName: () => "Dept",
    getDeptRoleConstraint: () => null,
    getProviderModelConfig: () => ({ provider: "test", model: "test" }),
    getRecentConversationContext: () => "",
    handleSubtaskDelegationComplete: noop,
    handleTaskRunComplete: noop,
    hasExplicitWarningFixRequest: () => false,
    isTaskWorkflowInterrupted: () => false,
    l: (ko: string[], en: string[]) => ({ ko, en, ja: en, zh: en }),
    logsDir: "/tmp",
    notifyCeo: noop,
    nowMs: () => Date.now(),
    pickL: (pool: any) => pool.en[0],
    randomDelay: () => 0,
    recordTaskCreationAudit: noop,
    resolveLang: () => "en",
    sendAgentMessage: noop,
    spawnCliAgent: noopAsync,
    startProgressTimer: () => noop,
    startTaskExecutionForAgent: noop,
  };
}

describe("resolveProjectPath", () => {
  it("resolves path from project_id via DB lookup", () => {
    const db = setupDb();
    try {
      db.prepare(
        "INSERT INTO projects (id, name, core_goal, project_path, default_pack_key) VALUES (?, ?, ?, ?, ?)",
      ).run("proj-1", "TestProject", "goal", "/home/user/projects/test-project", "development");

      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({ project_id: "proj-1" });

      expect(result).toBe("/home/user/projects/test-project");
    } finally {
      db.close();
    }
  });

  it("project_id takes priority over task.project_path", () => {
    const db = setupDb();
    try {
      db.prepare(
        "INSERT INTO projects (id, name, core_goal, project_path, default_pack_key) VALUES (?, ?, ?, ?, ?)",
      ).run("proj-1", "TestProject", "goal", "/home/user/projects/from-db", "development");

      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: "proj-1",
        project_path: "/home/user/projects/from-task",
      });

      expect(result).toBe("/home/user/projects/from-db");
    } finally {
      db.close();
    }
  });

  it("falls through to task.project_path when project_id is not found in DB", () => {
    const db = setupDb();
    try {
      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: "nonexistent-id",
        project_path: "/tmp/fallback-path",
      });

      expect(result).toBe("/tmp/fallback-path");
    } finally {
      db.close();
    }
  });

  it("falls through to task.project_path when project_id is null", () => {
    const db = setupDb();
    try {
      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: null,
        project_path: "/tmp/direct-path",
      });

      expect(result).toBe("/tmp/direct-path");
    } finally {
      db.close();
    }
  });

  it("falls through to process.cwd() when nothing else matches", () => {
    const db = setupDb();
    try {
      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: null,
        project_path: null,
        description: null,
        title: "",
      });

      expect(result).toBe(process.cwd());
    } finally {
      db.close();
    }
  });

  it("falls through to process.cwd() when all fields are empty strings", () => {
    const db = setupDb();
    try {
      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: "",
        project_path: "  ",
        description: "",
        title: "",
      });

      expect(result).toBe(process.cwd());
    } finally {
      db.close();
    }
  });

  it("always returns a string, never null or undefined", () => {
    const db = setupDb();
    try {
      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));

      const result1 = resolveProjectPath({});
      expect(typeof result1).toBe("string");
      expect(result1.length).toBeGreaterThan(0);

      const result2 = resolveProjectPath({ project_id: null, project_path: null });
      expect(typeof result2).toBe("string");
      expect(result2.length).toBeGreaterThan(0);

      const result3 = resolveProjectPath({
        project_id: "missing",
        project_path: "",
        description: "",
        title: "",
      });
      expect(typeof result3).toBe("string");
      expect(result3.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("falls through to task.project_path when project_id row has empty project_path", () => {
    const db = setupDb();
    try {
      db.prepare(
        "INSERT INTO projects (id, name, core_goal, project_path, default_pack_key) VALUES (?, ?, ?, ?, ?)",
      ).run("proj-empty", "EmptyPath", "goal", "", "development");

      const { resolveProjectPath } = initializeCollabCoordination(createMinimalCtx(db));
      const result = resolveProjectPath({
        project_id: "proj-empty",
        project_path: "/tmp/task-fallback",
      });

      expect(result).toBe("/tmp/task-fallback");
    } finally {
      db.close();
    }
  });
});
