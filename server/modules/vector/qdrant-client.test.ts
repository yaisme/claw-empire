import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  qdrantHealthCheck,
  qdrantEnsureCollection,
  qdrantUpsertPoints,
  qdrantSearch,
  qdrantDeletePoints,
  qdrantGetCollectionInfo,
} from "./qdrant-client.ts";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function okResponse(data: unknown = {}) {
  return { ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve("") };
}

function errorResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}), text: () => Promise.resolve("error") };
}

describe("qdrantHealthCheck", () => {
  it("returns true when healthy", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    expect(await qdrantHealthCheck("http://localhost:6333")).toBe(true);
  });

  it("returns false on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("connection refused"));
    expect(await qdrantHealthCheck("http://localhost:6333")).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse());
    expect(await qdrantHealthCheck("http://localhost:6333")).toBe(false);
  });
});

describe("qdrantEnsureCollection", () => {
  it("does nothing if collection already exists", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    await qdrantEnsureCollection("http://localhost:6333", "test", 384);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("creates collection if not found", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));
    mockFetch.mockResolvedValueOnce(okResponse());
    await qdrantEnsureCollection("http://localhost:6333", "test", 384);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const createCall = mockFetch.mock.calls[1];
    expect(createCall[0]).toContain("/collections/test");
    expect(createCall[1].method).toBe("PUT");
  });

  it("throws on creation failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    await expect(qdrantEnsureCollection("http://localhost:6333", "test", 384)).rejects.toThrow("failed to create");
  });
});

describe("qdrantUpsertPoints", () => {
  it("upserts points", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    await qdrantUpsertPoints("http://localhost:6333", "col", [
      { id: "p1", vector: [0.1, 0.2], payload: { title: "test" } },
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips empty points array", async () => {
    await qdrantUpsertPoints("http://localhost:6333", "col", []);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("qdrantSearch", () => {
  it("returns search results", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        result: [
          { id: "p1", score: 0.95, payload: { title: "match" } },
        ],
      }),
    );
    const results = await qdrantSearch("http://localhost:6333", "col", [0.1, 0.2], 5);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.95);
  });

  it("returns empty array on error", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse());
    const results = await qdrantSearch("http://localhost:6333", "col", [0.1], 5);
    expect(results).toEqual([]);
  });
});

describe("qdrantDeletePoints", () => {
  it("deletes specified point IDs", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());
    await qdrantDeletePoints("http://localhost:6333", "col", ["p1", "p2"]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("skips empty IDs array", async () => {
    await qdrantDeletePoints("http://localhost:6333", "col", []);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("qdrantGetCollectionInfo", () => {
  it("returns collection info", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ result: { points_count: 42, status: "green" } }),
    );
    const info = await qdrantGetCollectionInfo("http://localhost:6333", "col");
    expect(info).toEqual({ points_count: 42, status: "green" });
  });

  it("returns null on error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fail"));
    const info = await qdrantGetCollectionInfo("http://localhost:6333", "col");
    expect(info).toBeNull();
  });
});
