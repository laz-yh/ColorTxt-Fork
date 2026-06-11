import { onMounted, onUnmounted, ref, type Ref } from "vue";
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import {
  addTokenUsage,
  ZERO_TOKEN_USAGE,
  type AITokenUsageTotals,
} from "@shared/aiTokenUsage";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  aiSmartFormatNeedsLlm,
  type AiSmartFormatSettings,
} from "@shared/aiSmartFormatTypes";
import {
  tryRecoverFormatOutputScope,
  validateFormatOutputPreserved,
} from "@shared/formatOutputValidation";
import { prepareTextForAiFormat } from "../reader/readerTextInputHygiene";
import { cleanHtmlRemnantsInText } from "@shared/htmlRemnantCleanup";
import {
  lineDeltaAfterReplace,
  planFullTextSegments,
  planSelectionSegments,
  type SmartFormatSegmentPlan,
} from "../aiSmartFormat/aiSmartFormatSegments";
import {
  applySmartFormatPostProcessToText,
  type SmartFormatPostProcessContext,
} from "../aiSmartFormat/aiSmartFormatTextPostProcess";
import type { SmartFormatReviewSession } from "../aiSmartFormat/aiSmartFormatReviewTypes";
import type { Chapter } from "../chapter";
import { appAlert } from "../services/appDialog";
import { appToast } from "../services/appToast";
import { isRetryableAiRequestError } from "@shared/aiRequestRetry";
import {
  resolveSmartFormatSkillPrompt,
  type AiSkillUserOverride,
} from "@shared/aiSkills";
export type AiSmartFormatScope = "full" | "selection";
let smartFormatRequestIdSeq = 1;
export function useAiSmartFormat(deps: {
  readerRef: Ref<InstanceType<typeof ReaderMain> | null>;
  chapters: Ref<readonly Chapter[]>;
  aiSmartFormat: Ref<AiSmartFormatSettings>;
  aiFeaturesEnabled: Ref<boolean>;
  aiSkillOverrides: Ref<Record<string, AiSkillUserOverride>>;
  compressBlankKeepOneBlank: Ref<boolean>;
  runEditFormatWithChapterSync: (
    format: () => Promise<boolean | undefined> | boolean | undefined,
  ) => Promise<void>;
  onReaderEditDirty: () => void;
  resyncMirrorFromReader: () => void;
}) {
  const running = ref(false);
  const progressOpen = ref(false);
  const progressLabel = ref("");
  const progressCurrent = ref(0);
  const progressTotal = ref(0);
  const progressShowTokenUsage = ref(false);
  const progressTokenUsage = ref<AITokenUsageTotals>({ ...ZERO_TOKEN_USAGE });
  const progressTokenUsageAvailable = ref(false);
  const progressTokenPricePerMillion = ref<AITokenPricePerMillion | null>(
    null,
  );
  const reviewOpen = ref(false);
  const reviewSession = ref<SmartFormatReviewSession | null>(null);
  let abortAc: AbortController | null = null;
  let activeRequestId = 0;
  let unsubProgress: (() => void) | null = null;
  onMounted(() => {
    unsubProgress = window.colorTxt.ai.onTextFormatProgress((ev) => {
      if (ev.requestId !== activeRequestId || !running.value) return;
      if (
        ev.retryAttempt != null &&
        ev.maxRetries != null &&
        ev.retryAttempt > 0
      ) {
        const base = progressLabel.value.replace(/，重试 \d+\/\d+$/, "");
        progressLabel.value = `${base}，重试 ${ev.retryAttempt}/${ev.maxRetries}`;
      }
    });
  });
  onUnmounted(() => {
    unsubProgress?.();
    unsubProgress = null;
  });
  function canUseSmartFormat(): boolean {
    if (!deps.aiFeaturesEnabled.value) return false;
    const s = deps.aiSmartFormat.value;
    return (
      s.mergeHardWrap ||
      s.fixPunctuation ||
      s.unifyDialogueQuotes !== "none" ||
      s.removePromotionalContent ||
      s.removePiracyWatermarks ||
      s.restoreGarbledChars ||
      s.restoreAsteriskMasks ||
      s.cleanHtmlRemnants ||
      s.autoCompressBlank ||
      s.autoLeadIndent
    );
  }
  function canUseSmartFormatLlm(): boolean {
    return (
      deps.aiFeaturesEnabled.value &&
      aiSmartFormatNeedsLlm(deps.aiSmartFormat.value)
    );
  }
  function readPostProcessContext(): SmartFormatPostProcessContext {
    const reader = deps.readerRef.value;
    return (
      reader?.getSmartFormatPostProcessContext?.() ?? {
        chapterMinCharCount: 0,
        isMarkdown: false,
        preserveMarkdownSourceLines: false,
        preservePhysicalSourceLines: false,
      }
    );
  }
  function readLinesFromModel(
    startLine: number,
    endLine: number,
  ): { text: string; contextBefore: string; contextAfter: string } {
    const reader = deps.readerRef.value;
    if (!reader) return { text: "", contextBefore: "", contextAfter: "" };
    const lc = reader.getModelLineCount?.() ?? 0;
    const parts: string[] = [];
    for (let ln = startLine; ln <= endLine && ln <= lc; ln++) {
      parts.push(reader.getEditorLineContent(ln));
    }
    const text = parts.join("\n");
    const beforeParts: string[] = [];
    for (let ln = Math.max(1, startLine - 2); ln < startLine; ln++) {
      beforeParts.push(reader.getEditorLineContent(ln));
    }
    const afterParts: string[] = [];
    for (let ln = endLine + 1; ln <= Math.min(lc, endLine + 2); ln++) {
      afterParts.push(reader.getEditorLineContent(ln));
    }
    return {
      text,
      contextBefore: beforeParts.join("\n"),
      contextAfter: afterParts.join("\n"),
    };
  }
  function resetProgressTokenUsage() {
    progressShowTokenUsage.value = false;
    progressTokenUsage.value = { ...ZERO_TOKEN_USAGE };
    progressTokenUsageAvailable.value = false;
    progressTokenPricePerMillion.value = null;
  }
  function recordSegmentTokenUsage(result: {
    tokenUsage?: AITokenUsageTotals;
    tokenUsageAvailable?: boolean;
  }) {
    if (result.tokenUsage) {
      progressTokenUsage.value = addTokenUsage(
        progressTokenUsage.value,
        result.tokenUsage,
      );
    }
    if (result.tokenUsageAvailable) {
      progressTokenUsageAvailable.value = true;
    }
  }
  function unlockSmartFormatRunning() {
    const reader = deps.readerRef.value;
    reader?.setSmartFormatRunning?.(false);
    running.value = false;
  }
  function openReview(session: SmartFormatReviewSession) {
    reviewSession.value = session;
    reviewOpen.value = true;
  }
  function closeReview() {
    reviewOpen.value = false;
    reviewSession.value = null;
    unlockSmartFormatRunning();
  }
  function finishWithProposedReview(
    scope: AiSmartFormatScope,
    rangeStart: number,
    rangeEnd: number,
    originalText: string,
    proposedText: string,
    stats?: { applied: number; skipped: number; stopped?: boolean },
  ) {
    progressOpen.value = false;
    if (originalText === proposedText) {
      unlockSmartFormatRunning();
      appToast(
        stats?.stopped ? "已停止排版（无变更）" : "排版完成（无变更）",
        stats?.stopped ? { kind: "warning" } : undefined,
      );
      return;
    }
    openReview({
      startLine: rangeStart,
      endLine: rangeEnd,
      originalText,
      proposedText,
      scope,
    });
    if (stats) {
      const parts: string[] = [];
      if (stats.applied > 0) parts.push(`已处理 ${stats.applied} 段`);
      if (stats.skipped > 0) parts.push(`跳过 ${stats.skipped} 段`);
      const detail = parts.length > 0 ? `${parts.join("，")}，` : "";
      if (stats.stopped) {
        appToast(`已停止排版，${detail}请预览确认后应用`, { kind: "warning" });
      } else if (parts.length > 0) {
        appToast(`${parts.join("，")}，请预览确认后应用`, { kind: "primary" });
      }
    }
  }
  async function processOneSegmentInMemory(
    plan: SmartFormatSegmentPlan,
    workingLines: string[],
    rangeStart: number,
    lineDeltaAcc: { value: number },
    index: number,
    total: number,
    settings: AiSmartFormatSettings,
  ): Promise<
    | { ok: true; changed?: boolean; skipped?: boolean }
    | { ok: false; fatal: true; message: string }
    | { ok: false; fatal: false; cancelled: true }
  > {
    const reader = deps.readerRef.value;
    if (!reader) return { ok: false, fatal: true, message: "编辑器未就绪" };
    const startIdx = plan.startLine - rangeStart + lineDeltaAcc.value;
    const endIdx = plan.endLine - rangeStart + lineDeltaAcc.value;
    const text = workingLines.slice(startIdx, endIdx + 1).join("\n");
    const { contextBefore, contextAfter } = readLinesFromModel(
      plan.startLine,
      plan.endLine,
    );
    let working = prepareTextForAiFormat(text);
    if (settings.cleanHtmlRemnants) {
      working = cleanHtmlRemnantsInText(working);
    }
    const baseline = working;
    if (
      !working.trim() &&
      !settings.autoCompressBlank &&
      !settings.autoLeadIndent
    ) {
      if (total > 1) progressCurrent.value = index + 1;
      return { ok: true, skipped: true };
    }
    progressLabel.value =
      total > 1 ? `第 ${index + 1}/${total} 段` : "正在处理…";
    if (aiSmartFormatNeedsLlm(settings)) {
      const res = await window.colorTxt.ai.textFormatCleanup({
        requestId: activeRequestId,
        segment: {
          id: plan.id,
          text: baseline,
          contextBefore,
          contextAfter,
        },
        mergeHardWrap: settings.mergeHardWrap,
        fixPunctuation: settings.fixPunctuation,
        unifyDialogueQuotes: settings.unifyDialogueQuotes,
        removePromotionalContent: settings.removePromotionalContent,
        removePiracyWatermarks: settings.removePiracyWatermarks,
        restoreGarbledChars: settings.restoreGarbledChars,
        restoreAsteriskMasks: settings.restoreAsteriskMasks,
        cleanHtmlRemnants: settings.cleanHtmlRemnants,
        skillPrompt: resolveSmartFormatSkillPrompt(deps.aiSkillOverrides.value),
      });
      if (abortAc?.signal.aborted) {
        return { ok: false, fatal: false, cancelled: true };
      }
      if (!res.ok) {
        const msg = res.error ?? "请求失败";
        if (isRetryableAiRequestError(new Error(msg))) {
          return {
            ok: false,
            fatal: true,
            message: `第 ${index + 1}/${total} 段请求失败：${msg}`,
          };
        }
        return { ok: false, fatal: true, message: msg };
      }
      const result = res.result;
      recordSegmentTokenUsage(result);
      if (result.error) {
        return {
          ok: false,
          fatal: true,
          message: `第 ${index + 1}/${total} 段：${result.error}`,
        };
      }
      working = result.text;
      const validationOpts = {
        restoreGarbledChars: settings.restoreGarbledChars,
        restoreAsteriskMasks: settings.restoreAsteriskMasks,
        fixPunctuation: settings.fixPunctuation,
        unifyDialogueQuotes: settings.unifyDialogueQuotes,
        removePromotionalContent: settings.removePromotionalContent,
        removePiracyWatermarks: settings.removePiracyWatermarks,
      };
      const recovered = tryRecoverFormatOutputScope(
        baseline,
        working,
        validationOpts,
      );
      if (recovered.recovered) {
        working = recovered.text;
      }
      const validation = validateFormatOutputPreserved(
        baseline,
        working,
        validationOpts,
      );
      if (!validation.ok) {
        if (total > 1) progressCurrent.value = index + 1;
        return { ok: true, skipped: true };
      }
    }
    let changed = false;
    if (working !== text) {
      const newLines = working.split("\n");
      workingLines.splice(startIdx, endIdx - startIdx + 1, ...newLines);
      lineDeltaAcc.value += lineDeltaAfterReplace(text, working);
      changed = true;
    }
    reader.revealSmartFormatSegment?.(plan.startLine);
    if (total > 1) progressCurrent.value = index + 1;
    return { ok: true, changed };
  }
  function buildProposedText(
    originalText: string,
    settings: AiSmartFormatSettings,
  ): string {
    return applySmartFormatPostProcessToText(
      originalText,
      settings,
      readPostProcessContext(),
      deps.compressBlankKeepOneBlank.value,
    );
  }
  async function runSmartFormat(scope: AiSmartFormatScope): Promise<void> {
    if (running.value || reviewOpen.value) return;
    if (!canUseSmartFormat()) {
      appToast("请先在设置 → 编辑中启用 AI 智能排版选项");
      return;
    }
    if (aiSmartFormatNeedsLlm(deps.aiSmartFormat.value)) {
      try {
        const c = await window.colorTxt.ai.configGet();
        if (!c.aiEnabled || !c.chat?.model?.trim()) {
          await appAlert("请先在设置中启用 AI 阅读助手并配置对话模型。");
          return;
        }
      } catch {
        await appAlert("无法读取 AI 配置。");
        return;
      }
    }
    const reader = deps.readerRef.value;
    if (!reader) return;
    const fullText = reader.getAllText?.() ?? "";
    const lineCount = reader.getModelLineCount?.() ?? 0;
    if (!fullText.trim()) {
      appToast("当前没有可排版的正文");
      return;
    }
    let plans: SmartFormatSegmentPlan[] = [];
    if (scope === "full") {
      plans = planFullTextSegments(lineCount, deps.chapters.value, fullText);
    } else {
      const range = reader.getSelectionRange?.();
      if (!range || range.isEmpty()) {
        appToast("请先选中要排版的文本");
        return;
      }
      plans = planSelectionSegments(
        fullText,
        range.startLineNumber,
        range.endLineNumber,
      );
    }
    if (plans.length === 0) {
      appToast("无法切分排版范围");
      return;
    }
    const rangeStart = plans[0]!.startLine;
    const rangeEnd = plans[plans.length - 1]!.endLine;
    const originalText = readLinesFromModel(rangeStart, rangeEnd).text;
    const settings = { ...deps.aiSmartFormat.value };
    const needsSegmentLoop =
      aiSmartFormatNeedsLlm(settings) || settings.cleanHtmlRemnants;
    resetProgressTokenUsage();
    running.value = true;
    progressOpen.value = true;
    reader.setSmartFormatRunning?.(true);
    if (!needsSegmentLoop) {
      progressLabel.value = "应用格式化…";
      try {
        const proposedText = buildProposedText(originalText, settings);
        finishWithProposedReview(
          scope,
          rangeStart,
          rangeEnd,
          originalText,
          proposedText,
        );
      } catch {
        unlockSmartFormatRunning();
        progressOpen.value = false;
        await appAlert("排版处理失败。");
      }
      return;
    }
    progressCurrent.value = 0;
    progressTotal.value = plans.length;
    progressLabel.value = "准备中…";
    if (aiSmartFormatNeedsLlm(settings)) {
      progressShowTokenUsage.value = true;
      try {
        const c = await window.colorTxt.ai.configGet();
        progressTokenPricePerMillion.value =
          c.chat?.tokenPricePerMillion ?? null;
      } catch {
        progressTokenPricePerMillion.value = null;
      }
    }
    activeRequestId = smartFormatRequestIdSeq++;
    abortAc = new AbortController();
    const workingLines = originalText.split("\n");
    const lineDeltaAcc = { value: 0 };
    let applied = 0;
    let skipped = 0;
    let lastAppliedSegmentIndex = -1;
    let cancelled = false;
    try {
      for (let i = 0; i < plans.length; i++) {
        if (abortAc.signal.aborted) {
          cancelled = true;
          break;
        }
        const outcome = await processOneSegmentInMemory(
          plans[i]!,
          workingLines,
          rangeStart,
          lineDeltaAcc,
          i,
          plans.length,
          settings,
        );
        if (!outcome.ok) {
          if ("cancelled" in outcome && outcome.cancelled) {
            cancelled = true;
            break;
          }
          if (outcome.fatal) {
            progressOpen.value = false;
            unlockSmartFormatRunning();
            await appAlert(
              `${outcome.message}\n\n主文档未被修改，请检查网络后重新执行。`,
            );
            return;
          }
        } else if (outcome.skipped) {
          skipped += 1;
        } else if (outcome.changed) {
          applied += 1;
          lastAppliedSegmentIndex = i;
        }
      }
      if (cancelled) {
        progressOpen.value = false;
        if (applied === 0) {
          unlockSmartFormatRunning();
          appToast("已停止排版", { kind: "warning" });
          return;
        }
        const lastPlan = plans[lastAppliedSegmentIndex]!;
        const partialOriginal = readLinesFromModel(
          rangeStart,
          lastPlan.endLine,
        ).text;
        const endIdx = lastPlan.endLine - rangeStart + lineDeltaAcc.value;
        let partialProposed = workingLines.slice(0, endIdx + 1).join("\n");
        partialProposed = buildProposedText(partialProposed, settings);
        finishWithProposedReview(
          scope,
          rangeStart,
          lastPlan.endLine,
          partialOriginal,
          partialProposed,
          { applied, skipped, stopped: true },
        );
        return;
      }
      let proposedText = workingLines.join("\n");
      proposedText = buildProposedText(proposedText, settings);
      finishWithProposedReview(
        scope,
        rangeStart,
        rangeEnd,
        originalText,
        proposedText,
        { applied, skipped },
      );
    } finally {
      void window.colorTxt.ai.textFormatAbort(activeRequestId);
      abortAc = null;
    }
  }
  function stopSmartFormat() {
    abortAc?.abort();
    void window.colorTxt.ai.textFormatAbort(activeRequestId);
  }
  async function applySmartFormatReview() {
    const session = reviewSession.value;
    const reader = deps.readerRef.value;
    if (!session || !reader) return;
    const proposedText =
      reader.getSmartFormatReviewModifiedText?.() ?? session.proposedText;
    let patched = false;
    await deps.runEditFormatWithChapterSync(() => {
      patched =
        reader.applyEditLineRangePatch?.(
          session.startLine,
          session.endLine,
          proposedText,
        ) ?? false;
      if (patched) deps.onReaderEditDirty();
      return patched;
    });
    deps.resyncMirrorFromReader();
    closeReview();
    if (patched) {
      reader.focusSmartFormatAppliedRange?.(session.startLine, proposedText);
    }
    appToast("已应用排版结果", { kind: "success" });
  }
  function discardSmartFormatReview() {
    closeReview();
    appToast("已放弃排版结果");
  }
  return {
    running,
    progressOpen,
    progressLabel,
    progressCurrent,
    progressTotal,
    progressShowTokenUsage,
    progressTokenUsage,
    progressTokenUsageAvailable,
    progressTokenPricePerMillion,
    reviewOpen,
    reviewSession,
    canUseSmartFormat,
    canUseSmartFormatLlm,
    runSmartFormat,
    stopSmartFormat,
    applySmartFormatReview,
    discardSmartFormatReview,
  };
}
