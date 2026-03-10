import { describe, expect, it, vi, beforeEach } from "vitest";
import { createVectorService } from "./vector-service.ts";

// Mock the underlying clients
vi.mock("./qdrant-client.ts", () => ({
  qdrantHealthCheck: vi.fn(),
  qdrantEnsureCollection: vi.fn(),
  qdrantUpsertPoints: vi.fn(),
  qdrantSearch: vi.fn(),
  qdrantDeletePoints: vi.fn(),
  qdrantGetCollectionInfo: vi.fn(),
}));

vi.mock("./embedding-client.ts", () => ({
  generateEmbedding: vi.fn(),
  detectEmbeddingDimension: vi.fn(),
}));

import { qdrantHealthCheck, qdrantEnsureCollection, qdrantUpsertPoints, qdrantSearch, qdrantDeletePoints, qdrantGetCollectionInfo } from "./qdrant-client.ts";
import { generateEmbedding, detectEmbeddingDimension } from "./embedding-client.ts";

const config = {
  qdrantUrl: "http://localhost:6333",
  embedding: { baseUrl: "http://localhost:11434", apiKey: "", model: "nomic-embed-text" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createVectorService", () => {
  it("starts unavailable before initialization", () => {
    const svc = createVectorService(config);
    expect(svc.isAvailable()).toBe(false);
  });

  it("becomes available after successful initialization", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(384);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);

    const svc = createVectorService(config);
    await svc.initialize();
    expect(svc.isAvailable()).toBe(true);
  });

  it("stays unavailable if Qdrant is down", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(false);

    const svc = createVectorService(config);
    await svc.initialize();
    expect(svc.isAvailable()).toBe(false);
  });

  it("stays unavailable if embedding detection fails", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockRejectedValue(new Error("no model"));

    const svc = createVectorService(config);
    await svc.initialize();
    expect(svc.isAvailable()).toBe(false);
  });
});

describe("indexTask", () => {
  it("generates embedding and upserts to Qdrant", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(3);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);
    (generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
    (qdrantUpsertPoints as any).mockResolvedValue(undefined);

    const svc = createVectorService(config);
    await svc.initialize();
    await svc.indexTask("t1", "Fix bug", "Some description", "Bug fixed successfully");

    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    expect(qdrantUpsertPoints).toHaveBeenCalledTimes(1);
    const points = (qdrantUpsertPoints as any).mock.calls[0][2];
    expect(points[0].id).toBe("t1");
    expect(points[0].payload.title).toBe("Fix bug");
  });

  it("does nothing when unavailable", async () => {
    const svc = createVectorService(config);
    await svc.indexTask("t1", "Fix bug", null, null);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});

describe("searchSimilarTasks", () => {
  it("returns scored task results", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(3);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);
    (generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
    (qdrantSearch as any).mockResolvedValue([
      { id: "t1", score: 0.95, payload: { task_id: "t1", title: "Past task", description: "desc", result_snippet: "done" } },
    ]);

    const svc = createVectorService(config);
    await svc.initialize();
    const results = await svc.searchSimilarTasks("find bugs");

    expect(results).toHaveLength(1);
    expect(results[0].taskId).toBe("t1");
    expect(results[0].score).toBe(0.95);
  });

  it("returns empty when unavailable", async () => {
    const svc = createVectorService(config);
    const results = await svc.searchSimilarTasks("anything");
    expect(results).toEqual([]);
  });
});

describe("searchMeetingInsights", () => {
  it("returns scored meeting entries", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(3);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);
    (generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
    (qdrantSearch as any).mockResolvedValue([
      { id: "m1", score: 0.8, payload: { meeting_id: "m1", task_id: "t1", speaker: "Alice", content: "Use tests" } },
    ]);

    const svc = createVectorService(config);
    await svc.initialize();
    const results = await svc.searchMeetingInsights("testing strategy");

    expect(results).toHaveLength(1);
    expect(results[0].speaker).toBe("Alice");
  });
});

describe("removeTask", () => {
  it("deletes from Qdrant", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(3);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);
    (qdrantDeletePoints as any).mockResolvedValue(undefined);

    const svc = createVectorService(config);
    await svc.initialize();
    await svc.removeTask("t1");

    expect(qdrantDeletePoints).toHaveBeenCalledWith("http://localhost:6333", "ce_tasks", ["t1"]);
  });
});

describe("getStatus", () => {
  it("returns unavailable when not initialized", async () => {
    const svc = createVectorService(config);
    const status = await svc.getStatus();
    expect(status.available).toBe(false);
  });

  it("returns collection stats when available", async () => {
    (qdrantHealthCheck as any).mockResolvedValue(true);
    (detectEmbeddingDimension as any).mockResolvedValue(3);
    (qdrantEnsureCollection as any).mockResolvedValue(undefined);
    (qdrantGetCollectionInfo as any).mockResolvedValue({ points_count: 10, status: "green" });

    const svc = createVectorService(config);
    await svc.initialize();
    const status = await svc.getStatus();

    expect(status.available).toBe(true);
    expect(status.tasks?.points).toBe(10);
    expect(status.meetings?.points).toBe(10);
  });
});
