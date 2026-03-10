import { describe, expect, it, vi, beforeEach } from "vitest";
import { generateEmbedding, generateEmbeddings, detectEmbeddingDimension } from "./embedding-client.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

const config = {
  baseUrl: "http://localhost:11434",
  apiKey: "",
  model: "nomic-embed-text",
};

function embeddingResponse(embeddings: number[][]) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: embeddings.map((e, i) => ({ embedding: e, index: i })),
      }),
    text: () => Promise.resolve(""),
  };
}

describe("generateEmbedding", () => {
  it("returns a single embedding vector", async () => {
    mockFetch.mockResolvedValueOnce(embeddingResponse([[0.1, 0.2, 0.3]]));
    const result = await generateEmbedding(config, "test text");
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("sends correct request body", async () => {
    mockFetch.mockResolvedValueOnce(embeddingResponse([[0.1]]));
    await generateEmbedding(config, "hello");
    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("http://localhost:11434/v1/embeddings");
    const body = JSON.parse(call[1].body);
    expect(body.model).toBe("nomic-embed-text");
    expect(body.input).toEqual(["hello"]);
  });

  it("includes Authorization header when apiKey is set", async () => {
    mockFetch.mockResolvedValueOnce(embeddingResponse([[0.1]]));
    await generateEmbedding({ ...config, apiKey: "sk-test" }, "hello");
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.authorization).toBe("Bearer sk-test");
  });
});

describe("generateEmbeddings", () => {
  it("returns multiple embedding vectors in order", async () => {
    mockFetch.mockResolvedValueOnce(
      embeddingResponse([
        [0.1, 0.2],
        [0.3, 0.4],
      ]),
    );
    const results = await generateEmbeddings(config, ["text1", "text2"]);
    expect(results).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("returns empty array for empty input", async () => {
    const result = await generateEmbeddings(config, []);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
    });
    await expect(generateEmbeddings(config, ["test"])).rejects.toThrow("embedding: 500");
  });

  it("throws on empty response data", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
    await expect(generateEmbeddings(config, ["test"])).rejects.toThrow("empty response");
  });

  it("trims input text to 8000 chars", async () => {
    mockFetch.mockResolvedValueOnce(embeddingResponse([[0.1]]));
    const longText = "a".repeat(10000);
    await generateEmbeddings(config, [longText]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.input[0].length).toBe(8000);
  });
});

describe("detectEmbeddingDimension", () => {
  it("returns vector length from test embedding", async () => {
    mockFetch.mockResolvedValueOnce(embeddingResponse([[0.1, 0.2, 0.3, 0.4]]));
    const dim = await detectEmbeddingDimension(config);
    expect(dim).toBe(4);
  });
});
