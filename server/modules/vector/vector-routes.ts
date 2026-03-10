/**
 * API routes for vector search operations.
 *
 * GET  /api/vector/status   — Qdrant health + collection stats
 * GET  /api/vector/search   — Semantic search (query: q, collection: tasks|meetings)
 * POST /api/vector/reindex  — Bulk re-index all completed tasks & meetings
 */

import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import type { VectorService } from "./vector-service.ts";

type VectorRoutesDeps = {
  app: Express;
  db: DatabaseSync;
  vectorService: VectorService;
};

export function registerVectorRoutes(deps: VectorRoutesDeps): void {
  const { app, db, vectorService } = deps;

  app.get("/api/vector/status", async (_req, res) => {
    try {
      const status = await vectorService.getStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/vector/search", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const collection = typeof req.query.collection === "string" ? req.query.collection : "tasks";
    const limit = Math.min(Number(req.query.limit) || 5, 20);

    if (!q) return res.status(400).json({ error: "missing_query" });
    if (!vectorService.isAvailable()) {
      return res.status(503).json({ error: "vector_service_unavailable" });
    }

    try {
      if (collection === "meetings") {
        const results = await vectorService.searchMeetingInsights(q, limit);
        res.json({ results });
      } else {
        const results = await vectorService.searchSimilarTasks(q, limit);
        res.json({ results });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/vector/reindex", async (_req, res) => {
    if (!vectorService.isAvailable()) {
      return res.status(503).json({ error: "vector_service_unavailable" });
    }

    try {
      const result = await vectorService.reindexAll(db);
      res.json({ ok: true, indexed: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
