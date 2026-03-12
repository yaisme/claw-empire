import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express, Request, Response } from "express";
import type { DatabaseSync } from "node:sqlite";
import Busboy from "busboy";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_FILES_PER_REQUEST = 5;
const ALLOWED_OWNER_TYPES = new Set(["task", "project"]);

interface AttachmentsDeps {
  app: Express;
  db: DatabaseSync;
  attachmentsDir: string;
}

interface AttachmentRow {
  id: string;
  owner_type: string;
  owner_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

function ownerExists(db: DatabaseSync, ownerType: string, ownerId: string): boolean {
  const table = ownerType === "task" ? "tasks" : "projects";
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(ownerId) as { id: string } | undefined;
  return !!row;
}

export function registerAttachmentRoutes({ app, db, attachmentsDir }: AttachmentsDeps): void {
  // Ensure attachments directory exists
  try {
    fs.mkdirSync(attachmentsDir, { recursive: true });
  } catch {
    // ignore
  }

  // POST /api/attachments/:ownerType/:ownerId — upload files
  app.post("/api/attachments/:ownerType/:ownerId", (req: Request, res: Response) => {
    const ownerType = String(req.params.ownerType);
    const ownerId = String(req.params.ownerId);
    if (!ALLOWED_OWNER_TYPES.has(ownerType)) {
      return res.status(400).json({ error: "invalid_owner_type" });
    }
    if (!ownerExists(db, ownerType, ownerId)) {
      return res.status(404).json({ error: "owner_not_found" });
    }

    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return res.status(400).json({ error: "multipart_required" });
    }

    const results: AttachmentRow[] = [];
    let finished = false;

    const busboy = Busboy({
      headers: req.headers as Record<string, string>,
      limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES_PER_REQUEST },
    });

    busboy.on("file", (_fieldname, fileStream, info) => {
      const { filename: originalName, mimeType } = info;

      const id = randomUUID();
      const ext = path.extname(originalName || "").slice(0, 16);
      const storedName = `${id}${ext}`;
      const filePath = path.join(attachmentsDir, storedName);

      let sizeBytes = 0;
      let truncated = false;

      fileStream.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
      });

      fileStream.on("limit", () => {
        truncated = true;
      });

      const writeStream = fs.createWriteStream(filePath);
      fileStream.pipe(writeStream);

      writeStream.on("finish", () => {
        if (truncated) {
          try {
            fs.unlinkSync(filePath);
          } catch {
            /* ignore */
          }
          return;
        }

        try {
          db.prepare(
            `INSERT INTO attachments (id, owner_type, owner_id, filename, original_name, mime_type, size_bytes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            ownerType,
            ownerId,
            storedName,
            originalName || "unknown",
            mimeType || "application/octet-stream",
            sizeBytes,
          );

          results.push({
            id,
            owner_type: ownerType,
            owner_id: ownerId,
            filename: storedName,
            original_name: originalName || "unknown",
            mime_type: mimeType || "application/octet-stream",
            size_bytes: sizeBytes,
            created_at: Date.now(),
          });
        } catch (err) {
          try {
            fs.unlinkSync(filePath);
          } catch {
            /* ignore */
          }
          console.error("[attachments] DB insert failed:", err);
        }
      });
    });

    busboy.on("finish", () => {
      if (finished) return;
      finished = true;
      // Small delay to let writeStream finish events fire
      setTimeout(() => {
        res.json({ ok: true, attachments: results });
      }, 50);
    });

    busboy.on("error", (err) => {
      if (finished) return;
      finished = true;
      console.error("[attachments] Upload error:", err);
      res.status(500).json({ error: "upload_failed" });
    });

    req.pipe(busboy);
  });

  // GET /api/attachments/:ownerType/:ownerId — list attachments
  app.get("/api/attachments/:ownerType/:ownerId", (req: Request, res: Response) => {
    const ownerType = String(req.params.ownerType);
    const ownerId = String(req.params.ownerId);
    if (!ALLOWED_OWNER_TYPES.has(ownerType)) {
      return res.status(400).json({ error: "invalid_owner_type" });
    }

    const rows = db
      .prepare("SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC")
      .all(ownerType, ownerId) as unknown as AttachmentRow[];

    res.json({ ok: true, attachments: rows });
  });

  // GET /api/attachments/download/:id — download a file
  app.get("/api/attachments/download/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as unknown as AttachmentRow | undefined;
    if (!row) return res.status(404).json({ error: "not_found" });

    const filePath = path.join(attachmentsDir, row.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file_missing" });
    }

    res.setHeader("Content-Type", row.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(row.original_name)}"`);
    res.setHeader("Content-Length", String(row.size_bytes));

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  });

  // DELETE /api/attachments/:id — delete an attachment
  app.delete("/api/attachments/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const row = db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as unknown as AttachmentRow | undefined;
    if (!row) return res.status(404).json({ error: "not_found" });

    // Remove file
    const filePath = path.join(attachmentsDir, row.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // best effort
    }

    db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
    res.json({ ok: true });
  });
}

/**
 * Clean up all attachments for a given owner (task or project).
 * Call this when deleting a task or project.
 */
export function deleteAttachmentsForOwner(
  db: DatabaseSync,
  attachmentsDir: string,
  ownerType: string,
  ownerId: string,
): void {
  const rows = db
    .prepare("SELECT filename FROM attachments WHERE owner_type = ? AND owner_id = ?")
    .all(ownerType, ownerId) as unknown as Array<{ filename: string }>;

  for (const row of rows) {
    const filePath = path.join(attachmentsDir, row.filename);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // best effort
    }
  }

  db.prepare("DELETE FROM attachments WHERE owner_type = ? AND owner_id = ?").run(ownerType, ownerId);
}

/**
 * Build a prompt block describing attachments for agent context.
 * Text files are inlined; binary files are listed with paths.
 */
export function buildAttachmentsPromptBlock(
  db: DatabaseSync,
  attachmentsDir: string,
  ownerType: string,
  ownerId: string,
): string | null {
  const rows = db
    .prepare("SELECT * FROM attachments WHERE owner_type = ? AND owner_id = ? ORDER BY created_at ASC")
    .all(ownerType, ownerId) as unknown as AttachmentRow[];

  if (rows.length === 0) return null;

  const TEXT_MIME_PREFIXES = [
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
  ];
  const MAX_INLINE_SIZE = 100 * 1024; // 100KB max inline

  const lines: string[] = ["[Attached Files / 첨부파일]"];

  for (const row of rows) {
    const filePath = path.join(attachmentsDir, row.filename);
    const isText = TEXT_MIME_PREFIXES.some((p) => row.mime_type.startsWith(p));

    if (isText && row.size_bytes <= MAX_INLINE_SIZE) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        lines.push(`--- ${row.original_name} (${row.mime_type}, ${row.size_bytes} bytes) ---`);
        lines.push(content);
        lines.push("--- end ---");
      } catch {
        lines.push(`- ${row.original_name} (${row.mime_type}, ${row.size_bytes} bytes) — file: ${filePath}`);
      }
    } else {
      lines.push(`- ${row.original_name} (${row.mime_type}, ${formatSize(row.size_bytes)}) — file: ${filePath}`);
    }
  }

  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
