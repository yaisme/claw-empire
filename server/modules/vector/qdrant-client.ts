/**
 * Thin HTTP REST client for Qdrant vector database.
 * Zero external dependencies — uses native fetch().
 */

export type QdrantPoint = {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
};

export type QdrantSearchResult = {
  id: string;
  score: number;
  payload: Record<string, unknown>;
};

export type QdrantFilter = {
  must?: Array<{ key: string; match: { value: string | number | boolean } }>;
};

const TIMEOUT_MS = 5_000;

async function qdrantFetch(
  baseUrl: string,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers: opts.body ? { "content-type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function qdrantHealthCheck(baseUrl: string): Promise<boolean> {
  try {
    const res = await qdrantFetch(baseUrl, "/healthz");
    return res.ok;
  } catch {
    return false;
  }
}

export async function qdrantEnsureCollection(
  baseUrl: string,
  name: string,
  vectorSize: number,
): Promise<void> {
  // Check if collection exists
  const check = await qdrantFetch(baseUrl, `/collections/${name}`);
  if (check.ok) return;

  // Create collection
  const res = await qdrantFetch(baseUrl, `/collections/${name}`, {
    method: "PUT",
    body: {
      vectors: { size: vectorSize, distance: "Cosine" },
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qdrant: failed to create collection '${name}': ${res.status} ${text}`);
  }
}

export async function qdrantUpsertPoints(
  baseUrl: string,
  collection: string,
  points: QdrantPoint[],
): Promise<void> {
  if (points.length === 0) return;
  const res = await qdrantFetch(baseUrl, `/collections/${collection}/points`, {
    method: "PUT",
    body: { points },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qdrant: upsert failed: ${res.status} ${text}`);
  }
}

export async function qdrantSearch(
  baseUrl: string,
  collection: string,
  vector: number[],
  limit: number,
  filter?: QdrantFilter,
): Promise<QdrantSearchResult[]> {
  const body: Record<string, unknown> = {
    vector,
    limit,
    with_payload: true,
  };
  if (filter) body.filter = filter;

  const res = await qdrantFetch(baseUrl, `/collections/${collection}/points/search`, {
    method: "POST",
    body,
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { result?: QdrantSearchResult[] };
  return data.result ?? [];
}

export async function qdrantDeletePoints(
  baseUrl: string,
  collection: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const res = await qdrantFetch(baseUrl, `/collections/${collection}/points/delete`, {
    method: "POST",
    body: { points: ids },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`qdrant: delete failed: ${res.status} ${text}`);
  }
}

export async function qdrantGetCollectionInfo(
  baseUrl: string,
  collection: string,
): Promise<{ points_count: number; status: string } | null> {
  try {
    const res = await qdrantFetch(baseUrl, `/collections/${collection}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: { points_count: number; status: string } };
    return data.result ?? null;
  } catch {
    return null;
  }
}
