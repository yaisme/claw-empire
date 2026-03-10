/**
 * Embedding generation via OpenAI-compatible /v1/embeddings endpoint.
 * Works with OpenAI, Ollama, OpenRouter, or any compatible API.
 */

const TIMEOUT_MS = 30_000;

export type EmbeddingConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimensions?: number;
};

export async function generateEmbedding(
  config: EmbeddingConfig,
  text: string,
): Promise<number[]> {
  const results = await generateEmbeddings(config, [text]);
  return results[0];
}

export async function generateEmbeddings(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Trim texts to avoid token limits
  const trimmed = texts.map((t) => t.slice(0, 8000));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${config.baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
    const body: Record<string, unknown> = {
      model: config.model,
      input: trimmed,
    };
    if (config.dimensions) body.dimensions = config.dimensions;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`embedding: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as {
      data?: Array<{ embedding: number[]; index: number }>;
    };

    if (!data.data || data.data.length === 0) {
      throw new Error("embedding: empty response");
    }

    // Sort by index to maintain input order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Detect the vector dimension for a given embedding config by sending a test request.
 */
export async function detectEmbeddingDimension(config: EmbeddingConfig): Promise<number> {
  const result = await generateEmbedding(config, "test");
  return result.length;
}
