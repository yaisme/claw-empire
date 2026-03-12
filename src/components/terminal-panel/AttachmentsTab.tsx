import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "../../api";
import * as api from "../../api";
import type { LangText } from "../../i18n";

interface AttachmentsTabProps {
  ownerType: "task" | "project";
  ownerId: string;
  t: (text: LangText) => string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeIcon(mime: string): string {
  if (mime.startsWith("image/")) return "\uD83D\uDDBC\uFE0F";
  if (mime.startsWith("text/")) return "\uD83D\uDCC4";
  if (mime.includes("pdf")) return "\uD83D\uDCC3";
  if (mime.includes("json") || mime.includes("javascript") || mime.includes("typescript")) return "\uD83D\uDCBB";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip")) return "\uD83D\uDCE6";
  return "\uD83D\uDCCE";
}

export default function AttachmentsTab({ ownerType, ownerId, t }: AttachmentsTabProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    try {
      const list = await api.listAttachments(ownerType, ownerId);
      setAttachments(list);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId]);

  useEffect(() => {
    setLoading(true);
    void loadAttachments();
  }, [loadAttachments]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        await api.uploadAttachments(ownerType, ownerId, files);
        await loadAttachments();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
    },
    [ownerType, ownerId, loadAttachments],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteAttachment(id);
        setAttachments((prev) => prev.filter((a) => a.id !== id));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      void handleUpload(files);
    },
    [handleUpload],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      void handleUpload(files);
      e.target.value = "";
    },
    [handleUpload],
  );

  return (
    <div
      className="flex-1 overflow-y-auto p-4 space-y-3"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Drop zone / upload area */}
      <div
        className={`rounded-lg border-2 border-dashed p-4 text-center transition cursor-pointer ${
          dragOver ? "border-cyan-400 bg-cyan-900/20" : ""
        }`}
        style={!dragOver ? { borderColor: "var(--th-border)", background: "var(--th-bg-surface)" } : undefined}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInput} />
        <div className="text-2xl mb-1">{uploading ? "\u23F3" : "\uD83D\uDCC1"}</div>
        <div className="text-xs" style={{ color: "var(--th-text-secondary)" }}>
          {uploading
            ? t({ ko: "업로드 중...", en: "Uploading...", ja: "アップロード中...", zh: "上传中..." })
            : t({
                ko: "파일을 드래그하거나 클릭하여 업로드",
                en: "Drag files here or click to upload",
                ja: "ファイルをドラッグまたはクリックしてアップロード",
                zh: "拖拽文件到此处或点击上传",
              })}
        </div>
        <div className="text-[10px] mt-1" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "최대 50MB, 한번에 5개", en: "Max 50MB, up to 5 files", ja: "最大50MB、一度に5ファイル", zh: "最大50MB，一次最多5个文件" })}
        </div>
      </div>

      {error && <div className="text-[11px] text-rose-300 break-words">{error}</div>}

      {/* Attachments list */}
      {loading ? (
        <div className="text-center text-xs py-6" style={{ color: "var(--th-text-muted)" }}>
          {t({ ko: "로딩 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
        </div>
      ) : attachments.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8" style={{ color: "var(--th-text-muted)" }}>
          <div className="text-3xl mb-2">{"\uD83D\uDCCE"}</div>
          <div className="text-sm">
            {t({
              ko: "첨부파일이 없습니다",
              en: "No attachments yet",
              ja: "添付ファイルがありません",
              zh: "暂无附件",
            })}
          </div>
          <div className="text-[10px] mt-1">
            {t({
              ko: "사진, 문서, 소스코드 등을 업로드하세요",
              en: "Upload images, documents, source code, etc.",
              ja: "画像、ドキュメント、ソースコードなどをアップロード",
              zh: "上传图片、文档、源代码等",
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 group"
              style={{ borderColor: "var(--th-border)", background: "var(--th-card-bg)" }}
            >
              <span className="text-lg flex-shrink-0">{mimeIcon(att.mime_type)}</span>
              <div className="flex-1 min-w-0">
                <div
                  className="text-xs truncate font-medium"
                  style={{ color: "var(--th-text-primary)" }}
                  title={att.original_name}
                >
                  {att.original_name}
                </div>
                <div className="text-[10px]" style={{ color: "var(--th-text-muted)" }}>
                  {formatSize(att.size_bytes)} &middot; {att.mime_type}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <a
                  href={api.getAttachmentDownloadUrl(att.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded transition opacity-70 hover:opacity-100"
                  style={{ color: "var(--th-text-secondary)" }}
                  title={t({ ko: "다운로드", en: "Download", ja: "ダウンロード", zh: "下载" })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </a>
                <button
                  onClick={() => void handleDelete(att.id)}
                  className="p-1 rounded transition opacity-50 hover:opacity-100 hover:text-rose-400"
                  style={{ color: "var(--th-text-secondary)" }}
                  title={t({ ko: "삭제", en: "Delete", ja: "削除", zh: "删除" })}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
