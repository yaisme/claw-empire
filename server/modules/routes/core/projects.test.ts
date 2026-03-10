import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createProjectRouteHelpers } from "./projects/helpers.ts";

function normalizeTextField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createHelpersWithDb(db?: DatabaseSync) {
  const database =
    db ??
    (() => {
      const d = new DatabaseSync(":memory:");
      d.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_path TEXT NOT NULL,
          core_goal TEXT,
          default_pack_key TEXT,
          assignment_mode TEXT DEFAULT 'auto',
          github_repo TEXT,
          last_used_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER
        );
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT 0
        );
      `);
      return d;
    })();
  const helpers = createProjectRouteHelpers({ db: database, normalizeTextField });
  return { db: database, helpers };
}

describe("normalizeProjectPathInput", () => {
  it("returns null for empty or whitespace input", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.normalizeProjectPathInput("")).toBeNull();
      expect(helpers.normalizeProjectPathInput("   ")).toBeNull();
      expect(helpers.normalizeProjectPathInput(null)).toBeNull();
      expect(helpers.normalizeProjectPathInput(undefined)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("expands ~ to home directory", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.normalizeProjectPathInput("~")).toBe(os.homedir());
    } finally {
      db.close();
    }
  });

  it("expands ~/subdir to home-based path", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.normalizeProjectPathInput("~/my-project");
      expect(result).toBe(path.join(os.homedir(), "my-project"));
    } finally {
      db.close();
    }
  });

  it("resolves relative paths to absolute using cwd", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.normalizeProjectPathInput("some/relative/path");
      expect(path.isAbsolute(result!)).toBe(true);
      expect(result).toBe(path.normalize(path.resolve(process.cwd(), "some/relative/path")));
    } finally {
      db.close();
    }
  });

  it("keeps absolute paths absolute", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.normalizeProjectPathInput("/usr/local/project");
      expect(result).toBe(path.normalize("/usr/local/project"));
    } finally {
      db.close();
    }
  });

  it("normalizes paths with extra separators and dots", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.normalizeProjectPathInput("/usr//local/../local/project");
      expect(result).toBe(path.normalize("/usr/local/project"));
    } finally {
      db.close();
    }
  });
});

describe("pathInsideRoot", () => {
  it("returns true when candidate equals root", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user/projects", "/home/user/projects")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("returns true for a child path", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user/projects/app", "/home/user/projects")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("returns true for deeply nested child path", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user/projects/a/b/c", "/home/user/projects")).toBe(true);
    } finally {
      db.close();
    }
  });

  it("returns false for a parent path (traversal)", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user", "/home/user/projects")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("returns false for a sibling path", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user/other", "/home/user/projects")).toBe(false);
    } finally {
      db.close();
    }
  });

  it("returns false for traversal attempts with ..", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      expect(helpers.pathInsideRoot("/home/user/projects/../other", "/home/user/projects")).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("isPathInsideAllowedRoots", () => {
  it("returns true when no allowed roots are configured (empty env)", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      // With no PROJECT_PATH_ALLOWED_ROOTS env set, the default is empty, so all paths allowed
      expect(helpers.isPathInsideAllowedRoots("/any/path")).toBe(true);
      expect(helpers.isPathInsideAllowedRoots("/some/other/path")).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe("findConflictingProjectByPath", () => {
  it("returns undefined when no projects exist", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.findConflictingProjectByPath("/some/path");
      expect(result).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("finds a project with the same path", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO projects (id, name, project_path, created_at) VALUES (?, ?, ?, ?)").run(
        "proj-1",
        "My Project",
        "/home/user/my-project",
        1000,
      );

      const result = helpers.findConflictingProjectByPath("/home/user/my-project");
      expect(result).toBeDefined();
      expect(result!.id).toBe("proj-1");
      expect(result!.name).toBe("My Project");
      expect(result!.project_path).toBe("/home/user/my-project");
    } finally {
      db.close();
    }
  });

  it("returns undefined when path does not match any project", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO projects (id, name, project_path, created_at) VALUES (?, ?, ?, ?)").run(
        "proj-1",
        "My Project",
        "/home/user/my-project",
        1000,
      );

      const result = helpers.findConflictingProjectByPath("/home/user/other-project");
      expect(result).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("excludes the specified project ID from conflict detection", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO projects (id, name, project_path, created_at) VALUES (?, ?, ?, ?)").run(
        "proj-1",
        "My Project",
        "/home/user/my-project",
        1000,
      );

      // Same path but excluding proj-1 — should not conflict (used during update)
      const result = helpers.findConflictingProjectByPath("/home/user/my-project", "proj-1");
      expect(result).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("still finds conflict when excludeProjectId does not match", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO projects (id, name, project_path, created_at) VALUES (?, ?, ?, ?)").run(
        "proj-1",
        "My Project",
        "/home/user/my-project",
        1000,
      );

      const result = helpers.findConflictingProjectByPath("/home/user/my-project", "proj-999");
      expect(result).toBeDefined();
      expect(result!.id).toBe("proj-1");
    } finally {
      db.close();
    }
  });
});

describe("validateProjectAgentIds", () => {
  it("returns empty agentIds when input is undefined", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds(undefined);
      expect(result).toEqual({ agentIds: [] });
    } finally {
      db.close();
    }
  });

  it("returns error when input is not an array", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds("not-an-array");
      expect(result).toEqual({ error: { code: "invalid_agent_ids_type" } });
    } finally {
      db.close();
    }
  });

  it("returns error when input is an object", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds({ id: "agent-1" });
      expect(result).toEqual({ error: { code: "invalid_agent_ids_type" } });
    } finally {
      db.close();
    }
  });

  it("returns empty agentIds for an empty array", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds([]);
      expect(result).toEqual({ agentIds: [] });
    } finally {
      db.close();
    }
  });

  it("returns empty agentIds when array only contains non-string / blank entries", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds([123, null, "", "   "]);
      expect(result).toEqual({ agentIds: [] });
    } finally {
      db.close();
    }
  });

  it("validates agent IDs exist in the database", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO agents (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "Agent One",
        "senior",
        1,
      );
      db.prepare("INSERT INTO agents (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-2",
        "Agent Two",
        "junior",
        2,
      );

      const result = helpers.validateProjectAgentIds(["agent-1", "agent-2"]);
      expect(result).toEqual({ agentIds: ["agent-1", "agent-2"] });
    } finally {
      db.close();
    }
  });

  it("returns error with invalid IDs when some agents do not exist", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO agents (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "Agent One",
        "senior",
        1,
      );

      const result = helpers.validateProjectAgentIds(["agent-1", "agent-missing"]);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error.code).toBe("invalid_agent_ids");
        expect(result.error.invalidIds).toEqual(["agent-missing"]);
      }
    } finally {
      db.close();
    }
  });

  it("returns error when all agent IDs are invalid", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      const result = helpers.validateProjectAgentIds(["ghost-1", "ghost-2"]);
      expect("error" in result).toBe(true);
      if ("error" in result) {
        expect(result.error.code).toBe("invalid_agent_ids");
        expect(result.error.invalidIds).toEqual(["ghost-1", "ghost-2"]);
      }
    } finally {
      db.close();
    }
  });

  it("deduplicates agent IDs", () => {
    const { helpers, db } = createHelpersWithDb();
    try {
      db.prepare("INSERT INTO agents (id, name, role, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "Agent One",
        "senior",
        1,
      );

      const result = helpers.validateProjectAgentIds(["agent-1", "agent-1", "agent-1"]);
      expect(result).toEqual({ agentIds: ["agent-1"] });
    } finally {
      db.close();
    }
  });
});
