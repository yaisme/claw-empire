import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";

import {
  getWorkflowPacks,
  createWorkflowPack,
  updateWorkflowPack,
  deleteWorkflowPack,
  getWorkflowPackImpact,
  type WorkflowPackConfig,
  type WorkflowPackImpact,
} from "../../api/workflow-skills-subtasks";
import type { TFunction } from "./types";

const BUILT_IN_PACKS = new Set([
  "development",
  "novel",
  "report",
  "video_preprod",
  "web_research_report",
  "roleplay",
]);

interface PacksSettingsTabProps {
  t: TFunction;
}

export default function PacksSettingsTab({ t }: PacksSettingsTabProps) {
  const [packs, setPacks] = useState<WorkflowPackConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPack, setEditingPack] = useState<WorkflowPackConfig | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ key: "", name: "", keywords: "" });
  const [deleteTarget, setDeleteTarget] = useState<{ key: string; name: string } | null>(null);
  const [impact, setImpact] = useState<WorkflowPackImpact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete confirmation form state
  const [forceCancel, setForceCancel] = useState(false);
  const [agentAction, setAgentAction] = useState<"reassign" | "delete">("reassign");

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);
  const [editKeywords, setEditKeywords] = useState("");

  const loadPacks = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getWorkflowPacks();
      setPacks(result.packs);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const handleCreateSubmit = async () => {
    const key = createForm.key.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) return;
    if (!createForm.name.trim()) return;

    setSaving(true);
    try {
      await createWorkflowPack({
        key,
        name: createForm.name.trim(),
        routing_keywords: createForm.keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      });
      setShowCreate(false);
      setCreateForm({ key: "", name: "", keywords: "" });
      await loadPacks();
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (pack: WorkflowPackConfig) => {
    setEditingPack(pack);
    setEditName(pack.name);
    setEditEnabled(pack.enabled);
    const kw = Array.isArray(pack.routing_keywords) ? (pack.routing_keywords as string[]) : [];
    setEditKeywords(kw.join(", "));
  };

  const handleEditSubmit = async () => {
    if (!editingPack) return;
    setSaving(true);
    try {
      await updateWorkflowPack(editingPack.key, {
        name: editName.trim(),
        enabled: editEnabled,
        routing_keywords: editKeywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
      });
      setEditingPack(null);
      await loadPacks();
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = async (pack: WorkflowPackConfig) => {
    setDeleteTarget({ key: pack.key, name: pack.name });
    setForceCancel(false);
    setAgentAction("reassign");
    try {
      const res = await getWorkflowPackImpact(pack.key);
      setImpact(res);
    } catch {
      setImpact(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWorkflowPack(deleteTarget.key, {
        force: forceCancel || undefined,
        agentAction,
      });
      setDeleteTarget(null);
      setImpact(null);
      await loadPacks();
    } catch {
      // silently ignore
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setImpact(null);
  };

  const keyValid = /^[a-z][a-z0-9_]*$/.test(createForm.key.trim());

  return (
    <>
      {/* Header + Add Button */}
      <section
        className="rounded-xl p-5 sm:p-6 space-y-5"
        style={{ background: "var(--th-card-bg)", border: "1px solid var(--th-card-border)" }}
      >
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-semibold uppercase tracking-wider"
            style={{ color: "var(--th-text-primary)" }}
          >
            {t({ ko: "워크플로우 팩", en: "Workflow Packs", ja: "ワークフローパック", zh: "工作流包" })}
          </h3>
          {!showCreate && (
            <button
              onClick={() => {
                setShowCreate(true);
                setEditingPack(null);
              }}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              {t({ ko: "팩 추가", en: "Add Pack", ja: "パック追加", zh: "添加包" })}
            </button>
          )}
        </div>

        {/* Create Form */}
        {showCreate && (
          <div
            className="rounded-lg p-4 space-y-3"
            style={{ background: "var(--th-input-bg)", border: "1px solid var(--th-card-border)" }}
          >
            <h4 className="text-sm font-medium" style={{ color: "var(--th-text-primary)" }}>
              {t({ ko: "새 팩 만들기", en: "Create New Pack", ja: "新しいパック作成", zh: "创建新包" })}
            </h4>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                {t({ ko: "키", en: "Key", ja: "キー", zh: "键" })}
              </label>
              <input
                type="text"
                value={createForm.key}
                onChange={(e) => setCreateForm({ ...createForm, key: e.target.value.toLowerCase() })}
                placeholder="my_pack"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                style={{
                  background: "var(--th-input-bg)",
                  borderColor: createForm.key && !keyValid ? "#ef4444" : "var(--th-input-border)",
                  color: "var(--th-text-primary)",
                }}
              />
              {createForm.key && !keyValid && (
                <p className="text-xs text-red-400 mt-1">
                  {t({
                    ko: "소문자, 숫자, 밑줄만 허용 (소문자로 시작)",
                    en: "Lowercase letters, numbers, underscores only (must start with a letter)",
                    ja: "小文字、数字、アンダースコアのみ（小文字で始まる）",
                    zh: "仅允许小写字母、数字和下划线（必须以字母开头）",
                  })}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                {t({ ko: "이름", en: "Name", ja: "名前", zh: "名称" })}
              </label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                style={{
                  background: "var(--th-input-bg)",
                  borderColor: "var(--th-input-border)",
                  color: "var(--th-text-primary)",
                }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                {t({
                  ko: "키워드 (쉼표 구분)",
                  en: "Keywords (comma-separated)",
                  ja: "キーワード（カンマ区切り）",
                  zh: "关键词（逗号分隔）",
                })}
              </label>
              <input
                type="text"
                value={createForm.keywords}
                onChange={(e) => setCreateForm({ ...createForm, keywords: e.target.value })}
                placeholder="keyword1, keyword2"
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                style={{
                  background: "var(--th-input-bg)",
                  borderColor: "var(--th-input-border)",
                  color: "var(--th-text-primary)",
                }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setCreateForm({ key: "", name: "", keywords: "" });
                }}
                className="bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                onClick={handleCreateSubmit}
                disabled={saving || !keyValid || !createForm.name.trim()}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {saving
                  ? t({ ko: "저장 중...", en: "Saving...", ja: "保存中...", zh: "保存中..." })
                  : t({ ko: "생성", en: "Create", ja: "作成", zh: "创建" })}
              </button>
            </div>
          </div>
        )}

        {/* Pack List */}
        {loading ? (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
              {t({ ko: "로딩 중...", en: "Loading...", ja: "読み込み中...", zh: "加载中..." })}
            </p>
          </div>
        ) : packs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
              {t({
                ko: "등록된 팩이 없습니다.",
                en: "No packs found.",
                ja: "パックがありません。",
                zh: "未找到包。",
              })}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {packs.map((pack) =>
              editingPack?.key === pack.key ? (
                /* Edit Form (inline) */
                <div
                  key={pack.key}
                  className="rounded-lg p-4 space-y-3"
                  style={{ background: "var(--th-input-bg)", border: "1px solid var(--th-card-border)" }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ background: "var(--th-card-bg)", color: "var(--th-text-secondary)" }}
                    >
                      {pack.key}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                      {t({ ko: "이름", en: "Name", ja: "名前", zh: "名称" })}
                    </label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                      style={{
                        background: "var(--th-input-bg)",
                        borderColor: "var(--th-input-border)",
                        color: "var(--th-text-primary)",
                      }}
                    />
                  </div>

                  <div
                    className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
                    style={{ borderColor: "var(--th-card-border)", background: "var(--th-input-bg)" }}
                  >
                    <label className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
                      {t({ ko: "활성화", en: "Enabled", ja: "有効", zh: "启用" })}
                    </label>
                    <button
                      type="button"
                      aria-pressed={editEnabled}
                      onClick={() => setEditEnabled(!editEnabled)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${editEnabled ? "bg-blue-500" : "bg-slate-600"}`}
                    >
                      <div
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                          editEnabled ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                      {t({
                        ko: "키워드 (쉼표 구분)",
                        en: "Keywords (comma-separated)",
                        ja: "キーワード（カンマ区切り）",
                        zh: "关键词（逗号分隔）",
                      })}
                    </label>
                    <input
                      type="text"
                      value={editKeywords}
                      onChange={(e) => setEditKeywords(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors"
                      style={{
                        background: "var(--th-input-bg)",
                        borderColor: "var(--th-input-border)",
                        color: "var(--th-text-primary)",
                      }}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => setEditingPack(null)}
                      className="bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
                    </button>
                    <button
                      onClick={handleEditSubmit}
                      disabled={saving || !editName.trim()}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      {saving
                        ? t({ ko: "저장 중...", en: "Saving...", ja: "保存中...", zh: "保存中..." })
                        : t({ ko: "저장", en: "Save", ja: "保存", zh: "保存" })}
                    </button>
                  </div>
                </div>
              ) : (
                /* Pack Row */
                <div
                  key={pack.key}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 sm:px-4"
                  style={{ borderColor: "var(--th-card-border)", background: "var(--th-input-bg)" }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-sm font-medium truncate"
                          style={{ color: "var(--th-text-primary)" }}
                        >
                          {pack.name}
                        </span>
                        <span
                          className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "var(--th-card-bg)", color: "var(--th-text-secondary)" }}
                        >
                          {pack.key}
                        </span>
                        {BUILT_IN_PACKS.has(pack.key) && (
                          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400 shrink-0">
                            {t({ ko: "기본", en: "built-in", ja: "組込", zh: "内置" })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ${
                        pack.enabled
                          ? "bg-green-500/20 text-green-400"
                          : "bg-slate-700/60 text-slate-500"
                      }`}
                    >
                      {pack.enabled
                        ? t({ ko: "활성", en: "Enabled", ja: "有効", zh: "启用" })
                        : t({ ko: "비활성", en: "Disabled", ja: "無効", zh: "禁用" })}
                    </span>

                    <button
                      onClick={() => startEdit(pack)}
                      className="p-1.5 rounded-md hover:bg-slate-700/50 transition-colors"
                      style={{ color: "var(--th-text-secondary)" }}
                      title={t({ ko: "편집", en: "Edit", ja: "編集", zh: "编辑" })}
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      onClick={() => handleDeleteClick(pack)}
                      disabled={pack.key === "development"}
                      className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      style={{ color: pack.key === "development" ? "var(--th-text-secondary)" : "#f87171" }}
                      title={
                        pack.key === "development"
                          ? t({
                              ko: "기본 팩은 삭제할 수 없습니다",
                              en: "Cannot delete default pack",
                              ja: "デフォルトパックは削除できません",
                              zh: "无法删除默认包",
                            })
                          : t({ ko: "삭제", en: "Delete", ja: "削除", zh: "删除" })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="relative w-full max-w-md mx-4 rounded-xl p-5 sm:p-6 space-y-4 shadow-2xl"
            style={{ background: "var(--th-card-bg)", border: "1px solid var(--th-card-border)" }}
          >
            <button
              onClick={cancelDelete}
              className="absolute top-3 right-3 p-1 rounded-md hover:bg-slate-700/50 transition-colors"
              style={{ color: "var(--th-text-secondary)" }}
            >
              <X size={16} />
            </button>

            <h3 className="text-sm font-semibold" style={{ color: "var(--th-text-primary)" }}>
              {t({
                ko: `"${deleteTarget.name}" 팩 삭제`,
                en: `Delete pack "${deleteTarget.name}"`,
                ja: `パック「${deleteTarget.name}」を削除`,
                zh: `删除包"${deleteTarget.name}"`,
              })}
            </h3>

            {impact ? (
              <div className="space-y-3">
                <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
                  {t({
                    ko: `에이전트 ${impact.agentCount}개, 활성 작업 ${impact.activeTaskCount}개, 전체 작업 ${impact.totalTaskCount}개, 프로젝트 ${impact.projectCount}개가 영향을 받습니다.`,
                    en: `${impact.agentCount} agents, ${impact.activeTaskCount} active tasks, ${impact.totalTaskCount} total tasks, ${impact.projectCount} projects will be affected.`,
                    ja: `エージェント${impact.agentCount}個、アクティブタスク${impact.activeTaskCount}個、総タスク${impact.totalTaskCount}個、プロジェクト${impact.projectCount}個が影響を受けます。`,
                    zh: `${impact.agentCount}个代理、${impact.activeTaskCount}个活跃任务、${impact.totalTaskCount}个总任务、${impact.projectCount}个项目将受到影响。`,
                  })}
                </p>

                {impact.activeTaskCount > 0 && (
                  <label
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    style={{
                      borderColor: "#f59e0b40",
                      background: "#f59e0b10",
                      color: "#fbbf24",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={forceCancel}
                      onChange={(e) => setForceCancel(e.target.checked)}
                      className="rounded"
                    />
                    {t({
                      ko: "활성 작업 강제 취소",
                      en: "Force cancel active tasks",
                      ja: "アクティブタスクを強制キャンセル",
                      zh: "强制取消活跃任务",
                    })}
                  </label>
                )}

                <fieldset className="space-y-2">
                  <legend className="text-xs mb-1" style={{ color: "var(--th-text-secondary)" }}>
                    {t({
                      ko: "에이전트 처리",
                      en: "Agent handling",
                      ja: "エージェント処理",
                      zh: "代理处理",
                    })}
                  </legend>
                  <label
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    style={{ color: "var(--th-text-primary)" }}
                  >
                    <input
                      type="radio"
                      name="agentAction"
                      checked={agentAction === "reassign"}
                      onChange={() => setAgentAction("reassign")}
                    />
                    {t({
                      ko: "에이전트를 팩 없음으로 재배정",
                      en: "Reassign agents to no pack",
                      ja: "エージェントをパックなしに再配置",
                      zh: "将代理重新分配到无包",
                    })}
                  </label>
                  <label
                    className="flex items-center gap-2 text-sm cursor-pointer"
                    style={{ color: "var(--th-text-primary)" }}
                  >
                    <input
                      type="radio"
                      name="agentAction"
                      checked={agentAction === "delete"}
                      onChange={() => setAgentAction("delete")}
                    />
                    {t({
                      ko: "에이전트 삭제",
                      en: "Delete agents",
                      ja: "エージェントを削除",
                      zh: "删除代理",
                    })}
                  </label>
                </fieldset>
              </div>
            ) : (
              <p className="text-sm" style={{ color: "var(--th-text-secondary)" }}>
                {t({
                  ko: "영향 분석 중...",
                  en: "Analyzing impact...",
                  ja: "影響を分析中...",
                  zh: "分析影响中...",
                })}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={cancelDelete}
                className="bg-slate-700/50 hover:bg-slate-600/50 text-slate-300 text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {t({ ko: "취소", en: "Cancel", ja: "キャンセル", zh: "取消" })}
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting || !impact || (impact.activeTaskCount > 0 && !forceCancel)}
                className="bg-red-600/80 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm px-4 py-2 rounded-lg transition-colors"
              >
                {deleting
                  ? t({ ko: "삭제 중...", en: "Deleting...", ja: "削除中...", zh: "删除中..." })
                  : t({ ko: "삭제 확인", en: "Confirm Delete", ja: "削除確認", zh: "确认删除" })}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
