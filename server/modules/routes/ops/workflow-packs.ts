import type { RuntimeContext } from "../../../types/runtime-context.ts";
import type { SQLInputValue } from "node:sqlite";
import { resolveSessionWorkflowPackFromDb } from "../../../messenger/session-agent-routing.ts";
import {
  DEFAULT_WORKFLOW_PACK_KEY,
  DEFAULT_WORKFLOW_PACK_SEEDS,
  isWorkflowPackKey,
  type WorkflowPackKey,
} from "../../workflow/packs/definitions.ts";

type WorkflowPackRow = {
  key: string;
  name: string;
  enabled: number;
  input_schema_json: string;
  prompt_preset_json: string;
  qa_rules_json: string;
  output_template_json: string;
  routing_keywords_json: string;
  cost_profile_json: string;
  created_at: number;
  updated_at: number;
};

type WorkflowRouteResult = {
  packKey: WorkflowPackKey;
  confidence: number;
  reason: string;
  candidates: Array<{ packKey: WorkflowPackKey; confidence: number; reason: string }>;
  requiresConfirmation: boolean;
};

function normalizeJsonStorageInput(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, error: "empty_json_text" };
    try {
      const parsed = JSON.parse(trimmed);
      return { ok: true, json: JSON.stringify(parsed) };
    } catch {
      return { ok: false, error: "invalid_json_text" };
    }
  }
  if (value === undefined) return { ok: false, error: "missing_json_value" };
  return { ok: true, json: JSON.stringify(value) };
}

function parseStoredJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function classifyWorkflowPack(text: string): WorkflowRouteResult {
  const normalized = String(text || "").trim();
  const lower = normalized.toLowerCase();
  if (!lower) {
    return {
      packKey: DEFAULT_WORKFLOW_PACK_KEY,
      confidence: 0.35,
      reason: "empty_text",
      candidates: [{ packKey: DEFAULT_WORKFLOW_PACK_KEY, confidence: 0.35, reason: "empty_text" }],
      requiresConfirmation: true,
    };
  }

  const scoreByPack = new Map<WorkflowPackKey, number>();
  const addScore = (key: WorkflowPackKey, delta: number) => {
    scoreByPack.set(key, (scoreByPack.get(key) ?? 0) + delta);
  };

  const matcher = (re: RegExp): boolean => re.test(normalized) || re.test(lower);

  if (matcher(/(웹\s*서치|web\s*search|research|리서치|자료\s*조사|market\s*research|fact\s*check)/i))
    addScore("web_research_report", 0.78);
  if (matcher(/(보고서|리포트|brief|summary\s*report|status\s*report|executive\s*summary)/i)) addScore("report", 0.74);
  if (matcher(/(소설|novel|fiction|chapter|스토리|세계관|시놉시스)/i)) addScore("novel", 0.76);
  if (matcher(/(영상|video|콘티|storyboard|shot\s*list|샷리스트|script\s*for\s*video|릴스|쇼츠)/i))
    addScore("video_preprod", 0.77);
  if (matcher(/(역할\s*놀이|roleplay|rp\b|캐릭터\s*대화|in\s*character)/i)) addScore("roleplay", 0.79);
  if (matcher(/(코드|개발|버그|테스트|fix|refactor|build|api|feature|deploy)/i)) addScore("development", 0.72);

  if (scoreByPack.size <= 0) {
    addScore("development", 0.5);
  }

  const sorted = Array.from(scoreByPack.entries())
    .map(([packKey, confidence]) => ({ packKey, confidence: Math.min(confidence, 0.98), reason: "keyword_match" }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = sorted[0]!;
  const requiresConfirmation = top.confidence < 0.72;
  return {
    packKey: top.packKey,
    confidence: top.confidence,
    reason: top.reason,
    candidates: sorted.slice(0, 3),
    requiresConfirmation,
  };
}

function packExistsInDb(db: RuntimeContext["db"], key: string): boolean {
  const row = db.prepare("SELECT key FROM workflow_packs WHERE key = ?").get(key);
  return !!row;
}

export function registerWorkflowPackRoutes(
  ctx: Pick<RuntimeContext, "app" | "db" | "nowMs" | "normalizeTextField">,
): void {
  const { app, db, nowMs, normalizeTextField } = ctx;

  app.get("/api/workflow-packs", (_req, res) => {
    const rows = db
      .prepare(
        `
      SELECT *
      FROM workflow_packs
      ORDER BY
        CASE key
          WHEN 'development' THEN 1
          WHEN 'report' THEN 2
          WHEN 'web_research_report' THEN 3
          WHEN 'roleplay' THEN 4
          WHEN 'novel' THEN 5
          WHEN 'video_preprod' THEN 6
          ELSE 99
        END,
        key
    `,
      )
      .all() as WorkflowPackRow[];

    if (rows.length <= 0) {
      const fallback = DEFAULT_WORKFLOW_PACK_SEEDS.map((pack) => ({
        key: pack.key,
        name: pack.name,
        enabled: true,
        input_schema: pack.inputSchema,
        prompt_preset: pack.promptPreset,
        qa_rules: pack.qaRules,
        output_template: pack.outputTemplate,
        routing_keywords: pack.routingKeywords,
        cost_profile: pack.costProfile,
      }));
      return res.json({ packs: fallback, source: "seed_fallback" });
    }

    const packs = rows.map((row) => ({
      key: row.key,
      name: row.name,
      enabled: row.enabled !== 0,
      input_schema: parseStoredJson(row.input_schema_json),
      prompt_preset: parseStoredJson(row.prompt_preset_json),
      qa_rules: parseStoredJson(row.qa_rules_json),
      output_template: parseStoredJson(row.output_template_json),
      routing_keywords: parseStoredJson(row.routing_keywords_json),
      cost_profile: parseStoredJson(row.cost_profile_json),
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
    return res.json({ packs });
  });

  app.put("/api/workflow-packs/:key", (req, res) => {
    const packKey = String(req.params.key || "").trim();
    if (!isWorkflowPackKey(packKey) && !packExistsInDb(db, packKey)) return res.status(400).json({ error: "invalid_pack_key" });

    const existing = db.prepare("SELECT key FROM workflow_packs WHERE key = ?").get(packKey) as
      | { key: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: "pack_not_found" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: string[] = ["updated_at = ?"];
    const params: SQLInputValue[] = [nowMs()];

    if ("name" in body) {
      const name = normalizeTextField(body.name);
      if (!name) return res.status(400).json({ error: "name_required" });
      updates.push("name = ?");
      params.push(name);
    }
    if ("enabled" in body) {
      const enabled = body.enabled === false || body.enabled === 0 || String(body.enabled) === "0" ? 0 : 1;
      updates.push("enabled = ?");
      params.push(enabled);
    }

    const jsonFieldSpecs: Array<{ dbField: string; aliases: string[] }> = [
      { dbField: "input_schema_json", aliases: ["input_schema", "inputSchema", "input_schema_json"] },
      { dbField: "prompt_preset_json", aliases: ["prompt_preset", "promptPreset", "prompt_preset_json"] },
      { dbField: "qa_rules_json", aliases: ["qa_rules", "qaRules", "qa_rules_json"] },
      { dbField: "output_template_json", aliases: ["output_template", "outputTemplate", "output_template_json"] },
      { dbField: "routing_keywords_json", aliases: ["routing_keywords", "routingKeywords", "routing_keywords_json"] },
      { dbField: "cost_profile_json", aliases: ["cost_profile", "costProfile", "cost_profile_json"] },
    ];

    for (const spec of jsonFieldSpecs) {
      const alias = spec.aliases.find((candidate) => candidate in body);
      if (!alias) continue;
      const normalized = normalizeJsonStorageInput(body[alias]);
      if (!normalized.ok) {
        return res.status(400).json({ error: "invalid_json_field", field: alias, reason: normalized.error });
      }
      updates.push(`${spec.dbField} = ?`);
      params.push(normalized.json);
    }

    if (updates.length <= 1) return res.status(400).json({ error: "no_fields" });

    params.push(packKey);
    db.prepare(`UPDATE workflow_packs SET ${updates.join(", ")} WHERE key = ?`).run(...params);

    const row = db.prepare("SELECT * FROM workflow_packs WHERE key = ?").get(packKey) as WorkflowPackRow | undefined;
    if (!row) return res.status(500).json({ error: "pack_reload_failed" });

    return res.json({
      ok: true,
      pack: {
        key: row.key,
        name: row.name,
        enabled: row.enabled !== 0,
        input_schema: parseStoredJson(row.input_schema_json),
        prompt_preset: parseStoredJson(row.prompt_preset_json),
        qa_rules: parseStoredJson(row.qa_rules_json),
        output_template: parseStoredJson(row.output_template_json),
        routing_keywords: parseStoredJson(row.routing_keywords_json),
        cost_profile: parseStoredJson(row.cost_profile_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  });

  // ── POST /api/workflow-packs — Create a new custom workflow pack ──
  app.post("/api/workflow-packs", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = normalizeTextField(body.key) ?? "";
    const name = normalizeTextField(body.name) ?? "";

    if (!/^[a-z][a-z0-9_]{1,49}$/.test(key)) {
      return res.status(400).json({ error: "invalid_key_format" });
    }
    if (isWorkflowPackKey(key)) {
      return res.status(400).json({ error: "key_is_builtin" });
    }
    if (packExistsInDb(db, key)) {
      return res.status(409).json({ error: "key_already_exists" });
    }
    if (!name) {
      return res.status(400).json({ error: "name_required" });
    }

    // Clone defaults from the "development" seed
    const devSeed = DEFAULT_WORKFLOW_PACK_SEEDS.find((s) => s.key === "development")!;
    const enabled = body.enabled === false || body.enabled === 0 || String(body.enabled) === "0" ? 0 : 1;

    const routingKeywordsInput = body.routing_keywords ?? body.routingKeywords ?? body.routing_keywords_json;
    let routingKeywordsJson: string;
    if (routingKeywordsInput !== undefined) {
      const normalized = normalizeJsonStorageInput(routingKeywordsInput);
      if (!normalized.ok) return res.status(400).json({ error: "invalid_json_field", field: "routing_keywords", reason: normalized.error });
      routingKeywordsJson = normalized.json;
    } else {
      routingKeywordsJson = JSON.stringify(devSeed.routingKeywords);
    }

    const now = nowMs();
    db.prepare(
      `INSERT INTO workflow_packs (key, name, enabled, input_schema_json, prompt_preset_json, qa_rules_json, output_template_json, routing_keywords_json, cost_profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      key,
      name,
      enabled,
      JSON.stringify(devSeed.inputSchema),
      JSON.stringify(devSeed.promptPreset),
      JSON.stringify(devSeed.qaRules),
      JSON.stringify(devSeed.outputTemplate),
      routingKeywordsJson,
      JSON.stringify(devSeed.costProfile),
      now,
      now,
    );

    const row = db.prepare("SELECT * FROM workflow_packs WHERE key = ?").get(key) as WorkflowPackRow | undefined;
    if (!row) return res.status(500).json({ error: "pack_insert_failed" });

    return res.status(201).json({
      ok: true,
      pack: {
        key: row.key,
        name: row.name,
        enabled: row.enabled !== 0,
        input_schema: parseStoredJson(row.input_schema_json),
        prompt_preset: parseStoredJson(row.prompt_preset_json),
        qa_rules: parseStoredJson(row.qa_rules_json),
        output_template: parseStoredJson(row.output_template_json),
        routing_keywords: parseStoredJson(row.routing_keywords_json),
        cost_profile: parseStoredJson(row.cost_profile_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    });
  });

  // ── GET /api/workflow-packs/:key/impact — Pre-delete impact check ──
  app.get("/api/workflow-packs/:key/impact", (req, res) => {
    const packKey = String(req.params.key || "").trim();
    if (!packKey) return res.status(400).json({ error: "invalid_pack_key" });

    if (!isWorkflowPackKey(packKey) && !packExistsInDb(db, packKey)) {
      return res.status(404).json({ error: "pack_not_found" });
    }

    const activeTaskRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE workflow_pack_key = ? AND status IN ('in_progress', 'review')")
      .get(packKey) as { cnt: number };
    const totalTaskRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE workflow_pack_key = ?")
      .get(packKey) as { cnt: number };
    const agentRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM agents WHERE workflow_pack_key = ?")
      .get(packKey) as { cnt: number };
    const projectRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM projects WHERE default_pack_key = ?")
      .get(packKey) as { cnt: number };

    const settingRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("officeWorkflowPack") as
      | { value: string }
      | undefined;
    const isActivePack = settingRow?.value === packKey;

    return res.json({
      activeTaskCount: activeTaskRow.cnt,
      totalTaskCount: totalTaskRow.cnt,
      agentCount: agentRow.cnt,
      projectCount: projectRow.cnt,
      isActivePack,
    });
  });

  // ── DELETE /api/workflow-packs/:key — Delete with cascade ──
  app.delete("/api/workflow-packs/:key", (req, res) => {
    const packKey = String(req.params.key || "").trim();

    if (packKey === "development") {
      return res.status(400).json({ error: "cannot_delete_default" });
    }
    if (!packExistsInDb(db, packKey)) {
      return res.status(404).json({ error: "pack_not_found" });
    }

    const forceRaw = String(req.query.force || "");
    const force = forceRaw === "true" || forceRaw === "1";
    const agentAction = String(req.query.agentAction || "reassign");

    // Check for active tasks
    const activeTaskRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM tasks WHERE workflow_pack_key = ? AND status IN ('in_progress', 'review')")
      .get(packKey) as { cnt: number };

    if (activeTaskRow.cnt > 0 && !force) {
      return res.status(409).json({ error: "active_tasks_exist", activeTaskCount: activeTaskRow.cnt });
    }

    const now = nowMs();

    // 1. If this is the active office pack, revert to "development"
    const settingRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("officeWorkflowPack") as
      | { value: string }
      | undefined;
    if (settingRow?.value === packKey) {
      db.prepare("UPDATE settings SET value = ? WHERE key = ?").run("development", "officeWorkflowPack");
    }

    // 2. If force, cancel active tasks
    if (force) {
      db.prepare(
        "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE workflow_pack_key = ? AND status IN ('in_progress', 'review')",
      ).run(now, packKey);
    }

    // 3. Reassign tasks to development pack (NOT NULL constraint)
    db.prepare("UPDATE tasks SET workflow_pack_key = 'development' WHERE workflow_pack_key = ?").run(packKey);

    // 4. Handle agents
    if (agentAction === "delete") {
      // Nullify FKs referencing these agents before deletion
      db.prepare(
        "UPDATE tasks SET assigned_agent_id = NULL WHERE assigned_agent_id IN (SELECT id FROM agents WHERE workflow_pack_key = ?)",
      ).run(packKey);
      db.prepare(
        "UPDATE subtasks SET assigned_agent_id = NULL WHERE assigned_agent_id IN (SELECT id FROM agents WHERE workflow_pack_key = ?)",
      ).run(packKey);
      db.prepare(
        "UPDATE meeting_minute_entries SET speaker_agent_id = NULL WHERE speaker_agent_id IN (SELECT id FROM agents WHERE workflow_pack_key = ?)",
      ).run(packKey);
      db.prepare(
        "UPDATE task_report_archives SET generated_by_agent_id = NULL WHERE generated_by_agent_id IN (SELECT id FROM agents WHERE workflow_pack_key = ?)",
      ).run(packKey);
      db.prepare(
        "UPDATE review_round_decision_states SET planner_agent_id = NULL WHERE planner_agent_id IN (SELECT id FROM agents WHERE workflow_pack_key = ?)",
      ).run(packKey);
      db.prepare("DELETE FROM agents WHERE workflow_pack_key = ?").run(packKey);
    } else {
      // reassign (default): detach agents back to development pack
      db.prepare(
        "UPDATE agents SET workflow_pack_key = 'development', department_id = NULL WHERE workflow_pack_key = ?",
      ).run(packKey);
    }

    // 5. Delete department associations
    db.prepare("DELETE FROM office_pack_departments WHERE workflow_pack_key = ?").run(packKey);

    // 6. Reassign projects to development pack (NOT NULL constraint)
    db.prepare("UPDATE projects SET default_pack_key = 'development' WHERE default_pack_key = ?").run(packKey);

    // 7. Remove from officePackProfiles setting
    const profilesRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("officePackProfiles") as
      | { value: string }
      | undefined;
    if (profilesRow?.value) {
      try {
        const profiles = JSON.parse(profilesRow.value) as Record<string, unknown>;
        if (packKey in profiles) {
          delete profiles[packKey];
          db.prepare("UPDATE settings SET value = ? WHERE key = ?").run(
            JSON.stringify(profiles),
            "officePackProfiles",
          );
        }
      } catch {
        // ignore malformed JSON in settings
      }
    }

    // 8. Delete the pack itself
    db.prepare("DELETE FROM workflow_packs WHERE key = ?").run(packKey);

    return res.json({ ok: true, deleted: packKey });
  });

  app.post("/api/workflow/route", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = normalizeTextField(body.text) ?? "";
    const explicitPackKey = normalizeTextField(body.workflow_pack_key ?? body.packKey);
    const sessionKey = normalizeTextField(body.session_key ?? body.sessionKey);
    const projectId = normalizeTextField(body.project_id ?? body.projectId);

    const enabledRows = db.prepare("SELECT key FROM workflow_packs WHERE enabled = 1").all() as Array<{ key: string }>;
    const enabledSet = new Set<WorkflowPackKey>(
      enabledRows.map((row) => row.key).filter((rowKey): rowKey is WorkflowPackKey => isWorkflowPackKey(rowKey)),
    );
    const isEnabled = (packKey: WorkflowPackKey): boolean => enabledSet.size <= 0 || enabledSet.has(packKey);

    if (explicitPackKey && isWorkflowPackKey(explicitPackKey) && isEnabled(explicitPackKey)) {
      return res.json({
        packKey: explicitPackKey,
        confidence: 1,
        reason: "explicit_request",
        candidates: [{ packKey: explicitPackKey, confidence: 1, reason: "explicit_request" }],
        requiresConfirmation: false,
      });
    }

    if (sessionKey) {
      const sessionPack = resolveSessionWorkflowPackFromDb({ db, sessionKey });
      if (sessionPack && isEnabled(sessionPack)) {
        return res.json({
          packKey: sessionPack,
          confidence: 0.95,
          reason: "session_default",
          candidates: [{ packKey: sessionPack, confidence: 0.95, reason: "session_default" }],
          requiresConfirmation: false,
        });
      }
    }

    if (projectId) {
      const row = db.prepare("SELECT default_pack_key FROM projects WHERE id = ?").get(projectId) as
        | { default_pack_key?: string | null }
        | undefined;
      const projectPack = normalizeTextField(row?.default_pack_key);
      if (projectPack && isWorkflowPackKey(projectPack) && isEnabled(projectPack)) {
        return res.json({
          packKey: projectPack,
          confidence: 0.9,
          reason: "project_default",
          candidates: [{ packKey: projectPack, confidence: 0.9, reason: "project_default" }],
          requiresConfirmation: false,
        });
      }
    }

    const inferred = classifyWorkflowPack(text);
    const inferredEnabled = isEnabled(inferred.packKey)
      ? inferred
      : {
          ...inferred,
          packKey: DEFAULT_WORKFLOW_PACK_KEY,
          confidence: Math.min(inferred.confidence, 0.6),
          reason: "inferred_pack_disabled",
          requiresConfirmation: true,
        };
    return res.json(inferredEnabled);
  });
}
