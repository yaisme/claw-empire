/**
 * VectorService — orchestrates Qdrant and embedding clients.
 *
 * Provides semantic search for tasks, meeting minutes, and prompt context.
 * Gracefully degrades: if Qdrant or embedding provider is unavailable,
 * all methods return empty results without throwing.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  qdrantHealthCheck,
  qdrantEnsureCollection,
  qdrantUpsertPoints,
  qdrantSearch,
  qdrantDeletePoints,
  qdrantGetCollectionInfo,
  type QdrantFilter,
} from "./qdrant-client.ts";
import {
  generateEmbedding,
  detectEmbeddingDimension,
  type EmbeddingConfig,
} from "./embedding-client.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoredTask = {
  taskId: string;
  title: string;
  description: string;
  resultSnippet: string;
  score: number;
};

export type ScoredMeetingEntry = {
  meetingId: string;
  taskId: string;
  speaker: string;
  content: string;
  score: number;
};

export type VectorServiceConfig = {
  qdrantUrl: string;
  embedding: EmbeddingConfig;
};

export type VectorService = {
  isAvailable(): boolean;
  initialize(): Promise<void>;
  indexTask(taskId: string, title: string, description: string | null, result: string | null): Promise<void>;
  indexMeetingMinutes(meetingId: string, taskId: string, entries: Array<{ speaker: string; content: string }>): Promise<void>;
  searchSimilarTasks(query: string, limit?: number): Promise<ScoredTask[]>;
  searchMeetingInsights(query: string, limit?: number): Promise<ScoredMeetingEntry[]>;
  removeTask(taskId: string): Promise<void>;
  reindexAll(db: DatabaseSync): Promise<{ tasks: number; meetings: number }>;
  getStatus(): Promise<{ available: boolean; tasks?: { points: number }; meetings?: { points: number } }>;
};

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

const COLLECTION_TASKS = "ce_tasks";
const COLLECTION_MEETINGS = "ce_meetings";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createVectorService(config: VectorServiceConfig): VectorService {
  const { qdrantUrl, embedding } = config;
  let available = false;
  let vectorDimension = 0;

  async function initialize(): Promise<void> {
    try {
      const healthy = await qdrantHealthCheck(qdrantUrl);
      if (!healthy) {
        console.warn("[vector] Qdrant not reachable at", qdrantUrl, "— vector search disabled");
        return;
      }

      // Detect embedding dimension
      vectorDimension = await detectEmbeddingDimension(embedding);
      if (vectorDimension <= 0) {
        console.warn("[vector] Failed to detect embedding dimension — vector search disabled");
        return;
      }

      // Ensure collections exist
      await qdrantEnsureCollection(qdrantUrl, COLLECTION_TASKS, vectorDimension);
      await qdrantEnsureCollection(qdrantUrl, COLLECTION_MEETINGS, vectorDimension);

      available = true;
      console.log(`[vector] Qdrant connected (dim=${vectorDimension}, url=${qdrantUrl})`);
    } catch (err: any) {
      console.warn("[vector] Initialization failed:", err.message, "— vector search disabled");
      available = false;
    }
  }

  function isAvailable(): boolean {
    return available;
  }

  async function indexTask(
    taskId: string,
    title: string,
    description: string | null,
    result: string | null,
  ): Promise<void> {
    if (!available) return;
    try {
      const text = [title, description ?? "", (result ?? "").slice(0, 2000)].filter(Boolean).join("\n");
      const vector = await generateEmbedding(embedding, text);
      await qdrantUpsertPoints(qdrantUrl, COLLECTION_TASKS, [
        {
          id: taskId,
          vector,
          payload: {
            task_id: taskId,
            title,
            description: (description ?? "").slice(0, 500),
            result_snippet: (result ?? "").slice(0, 500),
            indexed_at: Date.now(),
          },
        },
      ]);
    } catch (err: any) {
      console.warn("[vector] indexTask failed:", err.message);
    }
  }

  async function indexMeetingMinutes(
    meetingId: string,
    taskId: string,
    entries: Array<{ speaker: string; content: string }>,
  ): Promise<void> {
    if (!available || entries.length === 0) return;
    try {
      // Combine entries into one document per meeting
      const text = entries.map((e) => `${e.speaker}: ${e.content}`).join("\n").slice(0, 4000);
      const vector = await generateEmbedding(embedding, text);
      await qdrantUpsertPoints(qdrantUrl, COLLECTION_MEETINGS, [
        {
          id: meetingId,
          vector,
          payload: {
            meeting_id: meetingId,
            task_id: taskId,
            speaker: entries.map((e) => e.speaker).join(", "),
            content: text.slice(0, 1000),
            indexed_at: Date.now(),
          },
        },
      ]);
    } catch (err: any) {
      console.warn("[vector] indexMeetingMinutes failed:", err.message);
    }
  }

  async function searchSimilarTasks(query: string, limit = 5): Promise<ScoredTask[]> {
    if (!available) return [];
    try {
      const vector = await generateEmbedding(embedding, query.slice(0, 2000));
      const results = await qdrantSearch(qdrantUrl, COLLECTION_TASKS, vector, limit);
      return results.map((r) => ({
        taskId: (r.payload.task_id as string) ?? r.id,
        title: (r.payload.title as string) ?? "",
        description: (r.payload.description as string) ?? "",
        resultSnippet: (r.payload.result_snippet as string) ?? "",
        score: r.score,
      }));
    } catch (err: any) {
      console.warn("[vector] searchSimilarTasks failed:", err.message);
      return [];
    }
  }

  async function searchMeetingInsights(query: string, limit = 5): Promise<ScoredMeetingEntry[]> {
    if (!available) return [];
    try {
      const vector = await generateEmbedding(embedding, query.slice(0, 2000));
      const results = await qdrantSearch(qdrantUrl, COLLECTION_MEETINGS, vector, limit);
      return results.map((r) => ({
        meetingId: (r.payload.meeting_id as string) ?? r.id,
        taskId: (r.payload.task_id as string) ?? "",
        speaker: (r.payload.speaker as string) ?? "",
        content: (r.payload.content as string) ?? "",
        score: r.score,
      }));
    } catch (err: any) {
      console.warn("[vector] searchMeetingInsights failed:", err.message);
      return [];
    }
  }

  async function removeTask(taskId: string): Promise<void> {
    if (!available) return;
    try {
      await qdrantDeletePoints(qdrantUrl, COLLECTION_TASKS, [taskId]);
    } catch (err: any) {
      console.warn("[vector] removeTask failed:", err.message);
    }
  }

  async function reindexAll(db: DatabaseSync): Promise<{ tasks: number; meetings: number }> {
    if (!available) return { tasks: 0, meetings: 0 };

    let taskCount = 0;
    let meetingCount = 0;

    // Reindex completed tasks
    const tasks = db
      .prepare("SELECT id, title, description, result FROM tasks WHERE status = 'done' AND result IS NOT NULL")
      .all() as Array<{ id: string; title: string; description: string | null; result: string | null }>;

    for (const task of tasks) {
      await indexTask(task.id, task.title, task.description, task.result);
      taskCount++;
    }

    // Reindex completed meetings
    const meetings = db
      .prepare(
        `SELECT m.id AS meeting_id, m.task_id,
                GROUP_CONCAT(e.speaker_name || ': ' || e.content, '\n') AS combined
         FROM meeting_minutes m
         JOIN meeting_minute_entries e ON e.meeting_id = m.id
         WHERE m.status = 'completed'
         GROUP BY m.id`,
      )
      .all() as Array<{ meeting_id: string; task_id: string; combined: string }>;

    for (const meeting of meetings) {
      const entries = meeting.combined.split("\n").map((line) => {
        const colonIdx = line.indexOf(": ");
        return colonIdx > 0
          ? { speaker: line.slice(0, colonIdx), content: line.slice(colonIdx + 2) }
          : { speaker: "unknown", content: line };
      });
      await indexMeetingMinutes(meeting.meeting_id, meeting.task_id, entries);
      meetingCount++;
    }

    return { tasks: taskCount, meetings: meetingCount };
  }

  async function getStatus(): Promise<{
    available: boolean;
    tasks?: { points: number };
    meetings?: { points: number };
  }> {
    if (!available) return { available: false };
    const [taskInfo, meetingInfo] = await Promise.all([
      qdrantGetCollectionInfo(qdrantUrl, COLLECTION_TASKS),
      qdrantGetCollectionInfo(qdrantUrl, COLLECTION_MEETINGS),
    ]);
    return {
      available: true,
      tasks: taskInfo ? { points: taskInfo.points_count } : undefined,
      meetings: meetingInfo ? { points: meetingInfo.points_count } : undefined,
    };
  }

  return {
    isAvailable,
    initialize,
    indexTask,
    indexMeetingMinutes,
    searchSimilarTasks,
    searchMeetingInsights,
    removeTask,
    reindexAll,
    getStatus,
  };
}
