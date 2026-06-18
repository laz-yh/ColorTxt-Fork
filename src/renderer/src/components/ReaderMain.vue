<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  nextTick,
} from "vue";
import * as monaco from "monaco-editor";
import kingHwaFontUrl from "../assets/KingHwa_OldSong1.0.ttf?url";
import {
  type ChapterStickyLine,
  ensureStickyChapterBarClickDisabled,
  refreshStickyChapterScrollWidget,
  registerChapterStickyScrollProviders,
} from "../monaco/chapterStickyScroll";
import {
  buildChapterMinimapSectionHeaderDecorations,
  buildChapterTitleDecorations,
  getReaderMinimapCursorLineDecorColor,
  setReaderSyntaxHighlightEnabled,
} from "../monaco/readerInlineDecorations";
import { useReaderInlineSearch } from "../composables/useReaderInlineSearch";
import {
  replaceImgAnchorLinesWithViewZones,
  removeViewZonesById,
  type ReplaceImgAnchorsResult,
} from "../monaco/readerImageViewZones";
import { collectBlockMarkdownImageLines } from "../markdown/markdownImages";
import {
  atxHeadingPrefixLength,
  formatMarkdownHeadingLineForDisplay,
} from "../markdown/markdownChapter";
import {
  READER_EDITOR_DEFAULT_FONT_FAMILY,
  READER_EDITOR_DEFAULT_FONT_SIZE,
  buildReaderEditorCreateOptions,
  buildReaderEditorFontSizeUpdate,
  buildReaderEditorLineHeightUpdate,
  buildReaderMonacoModeEditorOptions,
  buildReaderOverviewRulerBorder,
} from "../monaco/readerEditorOptions";
import {
  createTxtrTextMonarchLanguage,
  type TxtrMonarchHighlightOptions,
} from "../monaco/txtrTextMonarch";
import { installReaderScrollKeyHandler } from "../monaco/readerKeyScroll";
import {
  applyLeadIndentFullWidth,
  chapterTitleForDisplay,
  leadingWhitespaceColumnCount,
} from "../chapter";
import {
  compressBlankLinesInText,
  leadIndentFullWidthInText,
  type SmartFormatPostProcessContext,
} from "../aiSmartFormat/aiSmartFormatTextPostProcess";
import { countLinesInText } from "../aiSmartFormat/aiSmartFormatSegments";
import {
  formatPhysicalPlainTextForReader,
  type ReaderDisplayFormatOptions,
} from "../reader/readerDisplayPipeline";
import {
  applyTextConvertDigits,
  applyTextConvertLetters,
  applyTextConvertZh,
} from "../services/textConvertApply";
import type {
  TextConvertWidthMode,
  TextConvertZhMode,
} from "@shared/textConvertTypes";
import { isMarkdownFilePath } from "../ebook/ebookFormat";
import {
  captureReaderViewportRestoreAnchor,
  computeScrollTopForLineAtViewportSlot,
  computeScrollTopForReaderViewportRestoreAnchor,
  READER_BOOKMARK_JUMP_SLOT_FROM_TOP,
  resolveDisplayLineForViewportRestore,
  type ReaderViewportRestoreAnchor,
} from "../reader/readerViewportAnchor";
import AppContextMenu from "./AppContextMenu.vue";
import ReaderSelectionToolbar from "./ReaderSelectionToolbar.vue";
import ReaderNoteInputPanel from "./ReaderNoteInputPanel.vue";
import ReaderImageLightbox from "./ReaderImageLightbox.vue";
import VoiceReadResumeGuide from "./VoiceReadResumeGuide.vue";
import "./readerMainMonaco.css";
import {
  positionFromClientPoint,
  clientXWithinSingleLineModelRange,
} from "../reader/readerEbookPointer";
import {
  buildEbookAnchorLookupCache,
  lookupEbookAnchorPhysicalLineCached,
  type EbookAnchorLookupCache,
} from "../reader/ebookAnchorLookup";
import {
  defaultChapterMinCharCount,
  defaultCompressBlankLines,
  defaultLeadIndentFullWidth,
  defaultMonacoAdvancedWrapping,
  defaultMonacoCustomHighlight,
  defaultMonacoSmoothScrolling,
  defaultReaderEditShowLineNumbers,
  defaultReaderEditMinimap,
  defaultTxtrDelimitedMatchCrossLine,
  defaultReaderLineHeightMultiple,
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  type ReaderSurfacePalette,
} from "../constants/appUi";
import { DEFAULT_HIGHLIGHT_COLORS_LIGHT } from "../constants/highlightColors";
import { DEFAULT_LINEATION_COLORS_LIGHT } from "../constants/lineationColors";
import {
  DEFAULT_LINEATION_LAST_COLORS,
  type LineationLastColorPrefs,
} from "../constants/annotationColors";
import type {
  HighlightWordsByIndex,
  ReaderAnnotationRecord,
} from "../stores/fileMetaStore";
import { useReaderAnnotations } from "../composables/useReaderAnnotations";
import { annotationMarkerCssRules } from "../reader/readerAnnotationDecor";
import { floorReadingPercentFromScrollRatio } from "../utils/format";
import {
  hasEscBeforeModalLayers,
  hasModalOnStack,
  READER_HL_FLOAT_ROOT_Z_INDEX,
  subscribeModalStackChange,
} from "../utils/modalStack";
import {
  isAllowedMdExternalUrl,
  lineContainsMdStripLink,
  mdLinkDecorationHoverMessage,
  extractMdFootnoteHoverTextFromLine,
  shiftMdInternalLinkSidecarDisplayLines,
  shiftMdLinkHitColumns,
  type MdCompactLinkHit,
  type MdInternalLinkSidecar,
} from "../markdown/markdownLinkShared";
import { stripMdInternalLinksFromText } from "../markdown/markdownInternalLinks";
import { resolveMarkdownAssetAbsPath } from "../markdown/markdownImages";
import { yieldToUi } from "../ebook/yieldToUi";
import { appAlert } from "../services/appDialog";
import type { SmartFormatReviewSession } from "../aiSmartFormat/aiSmartFormatReviewTypes";
import {
  useReaderSmartFormatDiff,
  type SmartFormatDiffContextMenuRequest,
} from "../composables/useReaderSmartFormatDiff";
import IconButton from "./IconButton.vue";
import { icons } from "../icons";

/** 与 `READER_HL_FLOAT_ROOT_Z_INDEX` 同步；低于 `AppModal` 蒙层（6000） */
const HL_FLOAT_Z_INDEX = READER_HL_FLOAT_ROOT_Z_INDEX;

const editorEl = ref<HTMLDivElement | null>(null);
const diffHostEl = ref<HTMLDivElement | null>(null);

const editorEditContextMenuOpen = ref(false);
const editorEditContextMenuX = ref(0);
const editorEditContextMenuY = ref(0);
const editorEditContextMenuHasSelection = ref(false);

const diffReviewContextMenuOpen = ref(false);
const diffReviewContextMenuX = ref(0);
const diffReviewContextMenuY = ref(0);
const diffReviewContextMenuSide = ref<SmartFormatDiffContextMenuRequest["side"]>(
  "modified",
);
const diffReviewContextMenuHasSelection = ref(false);

const diffReviewContextMenuItems = computed(() => {
  if (diffReviewContextMenuSide.value === "original") {
    return [
      {
        id: "copy",
        label: "复制",
        disabled: !diffReviewContextMenuHasSelection.value,
      },
    ];
  }
  return [
    {
      id: "cut",
      label: "剪切",
      disabled: !diffReviewContextMenuHasSelection.value,
    },
    {
      id: "copy",
      label: "复制",
      disabled: !diffReviewContextMenuHasSelection.value,
    },
    { id: "paste", label: "粘贴" },
  ];
});

const editorEditContextMenuItems = computed(() => {
  const items: Array<{
    id: string;
    label?: string;
    separator?: boolean;
    disabled?: boolean;
    iconHtml?: string;
  }> = [
    { id: "cut", label: "剪切" },
    { id: "copy", label: "复制" },
    { id: "paste", label: "粘贴" },
  ];
  if (
    props.aiFeaturesEnabled &&
    props.canUseAiSmartFormat &&
    !smartFormatReviewActive.value
  ) {
    items.push({ id: "sep-ai", separator: true });
    items.push({
      id: "ai-format-selection",
      label: "AI 智能排版：选中文本",
      iconHtml: icons.aiCompose,
      disabled: !editorEditContextMenuHasSelection.value,
    });
    items.push({
      id: "ai-format-full",
      label: "AI 智能排版：全文",
      iconHtml: icons.aiCompose,
    });
  }
  return items;
});
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null);
const model = shallowRef<monaco.editor.ITextModel | null>(null);
/** 章节标题行内装饰（`buildChapterTitleDecorations` / `inlineClassName` 着色）；与 View Zone 留白无关 */
const chapterTitleDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
const inlineSearchDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
const annotationDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
const voiceReadDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
/** 编辑态小地图：无选区时为当前行铺灰底（与蓝色选区区分） */
const minimapCursorLineDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
/** 编辑态小地图：章节标题（Monaco sectionHeaderText） */
const chapterMinimapDecorationsCollection =
  shallowRef<monaco.editor.IEditorDecorationsCollection | null>(null);
/** 朗读高亮行（供上一行/下一行以「正在播的行」为锚点） */
const voiceReadHighlightLine = ref<number | null>(null);
const imageLightboxSrc = ref("");
const imageViewZoneIds = ref<string[]>([]);
/** 滚动时与 View Zone 合成对齐：取消未执行的 rAF，避免 dispose 后仍 render */
let imageViewZoneScrollRenderRaf: number | null = null;
/** 电子书内链装饰 id（`deltaDecorations` 返回） */
let ebookInternalLinkDecorationIds: string[] = [];
const EBOOK_LINK_ICON_STYLE_ID = "reader-ebook-link-icon-styles";
/** 锚点 id → 物理行（strip 后、与正文行号一致） */
const ebookAnchorIdToPhysicalLine = shallowRef<Map<string, number>>(new Map());
let ebookAnchorLookupCache: EbookAnchorLookupCache | null = null;
/** 行首起经多段 MD 内链（中间可夹任意字符）收集的链内文案；重建章节时若标题以前缀命中则跳过 */
const ebookLeadingLinkLabelsByDisplayLine = shallowRef<
  ReadonlyMap<number, readonly string[]>
>(new Map());
const ebookInternalLinkHitCount = ref(0);
/** 按 Monaco 行号索引的内链命中，避免大文件点击时线性扫描全部链接 */
const ebookInternalLinkHitsByLine = shallowRef<
  Map<number, MdCompactLinkHit[]>
>(new Map());
/** 视口外缓冲行数：仅在此范围内向 Monaco 注册内链装饰（点击索引仍为全书） */
const EBOOK_LINK_VIEWPORT_DECORATION_BUFFER_LINES = 80;
const EBOOK_LINK_VIEWPORT_DECOR_SYNC_MS = 48;
let ebookLinkDecorIconRelToClass = new Map<string, string>();
let ebookLinkViewportDecorSyncTimer: ReturnType<typeof setTimeout> | null =
  null;
let ebookLinkViewportDecorLastKey = "";
let ebookLinkScrollDecorDisposable: monaco.IDisposable | null = null;
/** 须改动的行数超过此阈值时用单次全量 `applyEdits` 代替逐行替换（编辑态回退路径） */
const MD_LINK_BULK_STRIP_EDIT_THRESHOLD = 512;
/** 格式化阶段预剥离的内链侧车；插图删行后须 shift 再安装 */
let pendingEbookSidecar: MdInternalLinkSidecar | null = null;

const voiceReadScrollLocked = computed(
  () => props.voiceReadScrollLocked === true,
);

let removeHlGlobalListeners: (() => void) | null = null;
let unsubModalStack: (() => void) | null = null;
let removeVoiceReadKeyCapture: (() => void) | null = null;
let removeSmartFormatReviewKeyCapture: (() => void) | null = null;
const builtInThemes = new Set(["vs", "vs-dark"]);
/** 脚注/补全等溢出挂件容器（须带 `monaco-editor` + 主题类，否则挂到 body 后默认样式失效） */
let readerMonacoOverflowHost: HTMLDivElement | null = null;

function resolveMonacoThemeClass(themeName: string): string {
  if (themeName === "vs") return "vs";
  if (builtInThemes.has(themeName)) return themeName;
  return "vs-dark";
}

function ensureReaderMonacoOverflowHost(): HTMLDivElement {
  if (readerMonacoOverflowHost?.isConnected) return readerMonacoOverflowHost;
  const host = document.createElement("div");
  host.className = "monaco-editor reader-monaco-overflow-host";
  host.classList.add(resolveMonacoThemeClass(lastAppThemeName));
  document.body.appendChild(host);
  readerMonacoOverflowHost = host;
  return host;
}

function syncReaderMonacoOverflowHostTheme(themeName: string): void {
  const host = readerMonacoOverflowHost;
  if (!host) return;
  for (const cls of ["vs", "vs-dark", "hc-black", "hc-light"]) {
    host.classList.remove(cls);
  }
  host.classList.add(resolveMonacoThemeClass(themeName));
}

function disposeReaderMonacoOverflowHost(): void {
  readerMonacoOverflowHost?.remove();
  readerMonacoOverflowHost = null;
}

/** 行高 = round(fontSize * multiple)，由 App 持久化并同步 */
let lineHeightMultiple = defaultReaderLineHeightMultiple;
let currentFontFamily = READER_EDITOR_DEFAULT_FONT_FAMILY;
/** App 传入的主题名（vs / vs-dark），用于切换语法着色后重设 Monaco 主题 */
let lastAppThemeName = "vs";

let chaptersSnapshot: ChapterStickyLine[] = [];
/** `registerChapterStickyScrollProviders` 注入后赋值；`setChapters` 末尾触发折叠失效以刷新粘性条 */
let notifyChapterStickyFoldingRanges: (() => void) | null = null;
let stickyChapterScrollRefreshRaf: number | null = null;

/** 上次已写入的章节标题行内装饰对应的「章节行号序列」键；相同时可跳过 `collection.set`（仅着色，不含留白） */
let lastChapterTitleDecorationsLineKey = "";

function chapterLineNumbersKey(lineNumbers: readonly number[]): string {
  return lineNumbers.join("\0");
}

const languageId = "txtr-text";
const globalKey = "__TXTR_MONACO_LANG_REGISTERED__";
let providersDisposables: monaco.IDisposable[] = [];

export type ReaderClearOptions = {
  /** 为 true 时表示即将流式加载新正文：换模后保持关闭 sticky，直到 `streamLoading` 变 false */
  keepStickyHiddenForStream?: boolean;
};

const props = withDefaults(
  defineProps<{
    monacoCustomHighlight?: boolean;
    /** 与「内容上色」同时生效：成对引号/括号是否允许跨行 */
    txtrDelimitedMatchCrossLine?: boolean;
    /** 为 true 时由数据层压缩空行并标准化章节留白（标题下 1 行；标题上 1 或 2 行取决于「保留一个空行」） */
    compressBlankLines?: boolean;
    /** Monaco 高级换行策略（wrappingStrategy: advanced） */
    monacoAdvancedWrapping?: boolean;
    /** Monaco 平滑滚动（滚轮、revealLine、setScrollTop 等） */
    monacoSmoothScrolling?: boolean;
    /** 编辑模式下是否显示行号（只读模式始终关闭） */
    readerEditShowLineNumbers?: boolean;
    readerEditMinimap?: boolean;
    /** 主进程流式读盘期间为 true；关闭 sticky 避免旧文件黏性标题在加载全程残留 */
    streamLoading?: boolean;
    /** 合并用户覆盖后的阅读器表面色（亮色 / 暗色） */
    readerSurfaceLight?: ReaderSurfacePalette;
    readerSurfaceDark?: ReaderSurfacePalette;
    /** 当前主题下的高亮色列表（与设置中亮/暗数组之一对应） */
    highlightColors?: string[];
    /** 当前主题下的划线标注色列表（与设置中亮/暗数组之一对应） */
    lineationColors?: string[];
    /** 合并后的高亮词（全局 + 本书；上色时本书同色词优先） */
    highlightWordsByIndex?: HighlightWordsByIndex;
    /** 仅本书高亮词（选区浮层判定「是否已是高亮词」） */
    highlightWordsByIndexBookOnly?: HighlightWordsByIndex;
    /** 本书阅读器划线 / 笔记 */
    readerAnnotations?: ReaderAnnotationRecord[];
    lineationLastColors?: LineationLastColorPrefs;
    /** 已打开文件路径；为空时不显示选区高亮入口 */
    readerFilePath?: string | null;
    /** 电子书 MD 锚点/内链：物理行号 → Monaco 显示行（与流式滤空一致） */
    ebookAnchorPhysicalToDisplay?: (physicalLine: number) => number;
    /**
     * 压缩空行时：内链侧车按 Monaco 行序记的「行号」实为显示行，需先映回源物理行再与 `ebookAnchorPhysicalToDisplay` 配对。
     */
    ebookDisplayLineToPhysical?: (displayLine: number) => number;
    /** 在**打开**查找栏（非关闭）之前调用，例如自动点亮书钉 */
    beforeRevealFindWidget?: () => void;
    /** 语音朗读播放中：禁止打开查找栏 */
    voiceReadBlocksFind?: boolean;
    /** 语音朗读播放中：禁止用户滚动（遮罩 + 滚轮拦截） */
    voiceReadScrollLocked?: boolean;
    /** 语音朗读已暂停：显示视口中心开播指引线 */
    voiceReadPaused?: boolean;
    /** 编辑模式：Monaco 展示磁盘原文，不经阅读管线后处理 */
    readerEditMode?: boolean;
    /**
     * 只读→编辑前由 App 采集的视口锚点（物理行 + 折行行内下标）；
     * 须在 `readerEditMode` 置 true 之前写入，避免切换后视口采样失真。
     */
    readerEditRestoreAnchor?: import("../reader/readerViewportAnchor").ReaderViewportRestoreAnchor | null;
    /** 与流式读盘一致的磁盘 txt 路径（编辑读/存用） */
    physicalReaderPath?: string | null;
    /** 章节最少字数；压缩空行格式化时与侧栏章节表一致，不足者不插入标题上下空行 */
    chapterMinCharCount?: number;
    /** Markdown 只读模式：标题行展示时剥离 ATX `#`（不影响章节检测用的内存标题） */
    fileIsMarkdown?: boolean;
    /** 全屏阅读：只读时滚动条 `auto` 淡出；窗口模式仍常显 */
    readerFullscreen?: boolean;
    /** AI 阅读助手已启用（编辑右键智能排版项） */
    aiFeaturesEnabled?: boolean;
    /** 至少一项智能排版任务已开启（设置 → 编辑） */
    canUseAiSmartFormat?: boolean;
    /** 智能排版 Diff 预览（非 null 时在编辑器区域展示左右对比） */
    smartFormatReviewSession?: SmartFormatReviewSession | null;
    /** 与 Monaco 阅读区一致的正文字体 */
    monacoFontFamily?: string;
    /** 源文件物理行文本（标注 `text` 快照） */
    getPhysicalLineContent?: (physicalLine: number) => string;
    /** 当前展示层行文本（标注 `displayText` 快照） */
    getDisplayLineContent?: (displayLine: number) => string;
    /** 只读态行首全角缩进（标注列映射须与展示层一致） */
    leadIndentFullWidth?: boolean;
  }>(),
  {
    monacoCustomHighlight: defaultMonacoCustomHighlight,
    txtrDelimitedMatchCrossLine: defaultTxtrDelimitedMatchCrossLine,
    compressBlankLines: defaultCompressBlankLines,
    monacoAdvancedWrapping: defaultMonacoAdvancedWrapping,
    monacoSmoothScrolling: defaultMonacoSmoothScrolling,
    readerEditShowLineNumbers: defaultReaderEditShowLineNumbers,
    readerEditMinimap: defaultReaderEditMinimap,
    streamLoading: false,
    readerSurfaceLight: () => ({ ...defaultReaderPaletteLight }),
    readerSurfaceDark: () => ({ ...defaultReaderPaletteDark }),
    highlightColors: () => [...DEFAULT_HIGHLIGHT_COLORS_LIGHT],
    lineationColors: () => [...DEFAULT_LINEATION_COLORS_LIGHT],
    highlightWordsByIndex: undefined,
    highlightWordsByIndexBookOnly: undefined,
    readerAnnotations: () => [],
    lineationLastColors: () => ({ ...DEFAULT_LINEATION_LAST_COLORS }),
    readerFilePath: null,
    ebookAnchorPhysicalToDisplay: undefined,
    ebookDisplayLineToPhysical: undefined,
    beforeRevealFindWidget: undefined,
    voiceReadBlocksFind: false,
    voiceReadScrollLocked: false,
    voiceReadPaused: false,
    readerEditMode: false,
    readerEditRestoreAnchor: null,
    physicalReaderPath: null,
    chapterMinCharCount: defaultChapterMinCharCount,
    readerFullscreen: false,
    aiFeaturesEnabled: false,
    canUseAiSmartFormat: false,
    smartFormatReviewSession: null,
    monacoFontFamily: READER_EDITOR_DEFAULT_FONT_FAMILY,
    getPhysicalLineContent: undefined,
    getDisplayLineContent: undefined,
    leadIndentFullWidth: defaultLeadIndentFullWidth,
  },
);

const emit = defineEmits<{
  probeLineChange: [probeLine: number, fromScroll?: boolean];
  viewportTopLineChange: [lineNumber: number];
  viewportEndLineChange: [lineNumber: number];
  viewportVisualProgressChange: [percent: number, atBottom: boolean];
  addHighlightTerm: [payload: { text: string; colorIndex: number }];
  removeHighlightTerm: [payload: { text: string }];
  upsertReaderAnnotation: [annotation: ReaderAnnotationRecord];
  removeReaderAnnotation: [id: string];
  updateLineationLastColor: [
    payload: { type: import("../stores/fileMetaStore").ReaderLineationType; colorIndex: number },
  ];
  askAiWithQuote: [text: string];
  readerEditDirtyChange: [dirty: boolean];
  readerEditContentChange: [];
  readerEditLoaded: [payload: { encoding: string }];
  readerEditLoadFailed: [];
  readerEditSaveRequest: [];
  readerEditCursorChange: [
    payload: { line: number; column: number; selectionLength: number },
  ];
  voiceReadResume: [];
  aiSmartFormatFull: [];
  aiSmartFormatSelection: [];
  smartFormatReviewApply: [];
  smartFormatReviewDiscard: [];
  annotationQuotesChanged: [];
}>();

const smartFormatRunning = ref(false);

const smartFormatReviewActive = computed(
  () => props.smartFormatReviewSession != null,
);

const readerAnn = useReaderAnnotations({
  editor,
  model,
  readerAnnotations: () => props.readerAnnotations ?? [],
  lineationLastColors: () => props.lineationLastColors ?? DEFAULT_LINEATION_LAST_COLORS,
  readerFilePath: () => props.readerFilePath,
  readerEditMode: () => props.readerEditMode === true,
  monacoCustomHighlight: () => props.monacoCustomHighlight === true,
  highlightWordsByIndexBookOnly: () => props.highlightWordsByIndexBookOnly,
  highlightColorsLength: () => props.highlightColors.length,
  lineationColorsLength: () => props.lineationColors.length,
  emitUpsert: (ann) => emit("upsertReaderAnnotation", ann),
  emitRemove: (id) => emit("removeReaderAnnotation", id),
  emitUpdateLineationColor: (payload) => emit("updateLineationLastColor", payload),
  emitAddHighlightTerm: (payload) => emit("addHighlightTerm", payload),
  emitRemoveHighlightTerm: (payload) => emit("removeHighlightTerm", payload),
  emitAskAiWithQuote: (text) => emit("askAiWithQuote", text),
  ebookDisplayLineToPhysical: () => props.ebookDisplayLineToPhysical,
  ebookAnchorPhysicalToDisplay: () => props.ebookAnchorPhysicalToDisplay,
  getPhysicalLineContent: (line) => props.getPhysicalLineContent?.(line) ?? "",
  getDisplayLineContent: (line) => props.getDisplayLineContent?.(line) ?? "",
  leadIndentFullWidth: () => props.leadIndentFullWidth === true,
  onAnnotationIndexRebuilt: () => emit("annotationQuotesChanged"),
  annotationDecorationsCollection,
});

const {
  toolbarVisible,
  colorPickerMode,
  lineationPickerType,
  floatCenterX,
  floatRootTop,
  floatOpenDownward,
  floatRootRef,
  activeLineation,
  toolbarHasLineation,
  toolbarHasNote,
  lineationPickerSelectedIndex,
  hlPickerShowRemoveRow,
  hlPickerExistingColorIndex,
  notePanelOpen,
  notePanelDraft,
  notePanelEditing,
  notePanelSourceText,
  notePanelRootRef,
  closeNotePanel,
  onToolbarAction,
  onHighlightPickConfirm,
  onHighlightPickRemove,
  onLineationPickConfirm,
  onNotePanelConfirm,
  onNotePanelDelete,
  jumpToAnnotationRange,
  getAnnotationDisplayQuote,
  getAnnotationHitsByLine,
  rebuildAnnotationIndex,
  refreshAnnotationDecorations,
  bindAnnotationScrollSync,
  disposeAnnotationDecorations,
  onSelectionChangedDuringInteraction,
} = readerAnn;

const smartFormatReviewScopeLabel = computed(() => {
  const s = props.smartFormatReviewSession;
  if (!s) return "";
  const kind = s.scope === "full" ? "全文" : "选区";
  return `${kind} · 第 ${s.startLine}–${s.endLine} 行`;
});

function getDiffEditorOptionsInput(): import("../monaco/readerEditorOptions").ReaderEditorCreateOptionsInput {
  const e = editor.value;
  const fontSize =
    e?.getOption(monaco.editor.EditorOption.fontSize) ??
    READER_EDITOR_DEFAULT_FONT_SIZE;
  return {
    fontSize,
    lineHeightMultiple,
    fontFamily: currentFontFamily,
    theme: lastAppThemeName,
    smoothScrolling: props.monacoSmoothScrolling,
    wrappingStrategyAdvanced: props.monacoAdvancedWrapping,
  };
}

const {
  changeCount: smartFormatDiffChangeCount,
  showWhitespaceDiff: smartFormatDiffShowWhitespace,
  hideUnchangedRegionsEnabled: smartFormatDiffHideUnchanged,
  layoutDiffEditor,
  syncDiffEditorTypography,
  goToPreviousDiff: smartFormatDiffGoToPrevious,
  goToNextDiff: smartFormatDiffGoToNext,
  toggleShowWhitespaceDiff: smartFormatDiffToggleWhitespace,
  toggleHideUnchangedRegions: smartFormatDiffToggleHideUnchanged,
  getSmartFormatReviewModifiedText,
  diffEditor: smartFormatDiffEditor,
} = useReaderSmartFormatDiff({
    diffHostEl,
    session: () => props.smartFormatReviewSession,
    getCreateOptionsInput: getDiffEditorOptionsInput,
    onContextMenuRequest: (request) => {
      closeEditorEditContextMenu();
      diffReviewContextMenuSide.value = request.side;
      diffReviewContextMenuHasSelection.value = request.hasSelection;
      diffReviewContextMenuX.value = request.x;
      diffReviewContextMenuY.value = request.y;
      diffReviewContextMenuOpen.value = true;
    },
    onDiffEditorCursorActivity: (ed) => emitReaderEditCursorStatus(ed),
  });

function onSmartFormatReviewApply() {
  emit("smartFormatReviewApply");
}

function onSmartFormatReviewDiscard() {
  emit("smartFormatReviewDiscard");
}

let readerEditSavedSnapshot = "";
/** 载入编辑正文、恢复视口等程序化写入期间不判 dirty */
let readerEditSuppressDirty = false;
let readerEditContentDisposable: monaco.IDisposable | null = null;
/** 成功载入编辑态正文的磁盘路径，用于同路径内避免重复整文件读 */
let readerEditLoadedPhysicalKey = "";
let saveCommandDisposable: monaco.IDisposable | null = null;

function teardownReaderEditContentListener() {
  readerEditContentDisposable?.dispose();
  readerEditContentDisposable = null;
}

function emitReaderEditDirtyIfChanged() {
  const m = model.value;
  if (!m || !props.readerEditMode || readerEditSuppressDirty) return;
  const dirty = m.getValue() !== readerEditSavedSnapshot;
  emit("readerEditDirtyChange", dirty);
}

function onReaderEditModelContentChange() {
  emitReaderEditDirtyIfChanged();
  if (readerEditSuppressDirty) return;
  emit("readerEditContentChange");
  emitProbeLine(false);
}

/** 以 Monaco 当前全文为「未修改」基线（须在 setValue / 视口恢复之后调用） */
function sealReaderEditBaseline() {
  const m = model.value;
  if (!m) return;
  readerEditSavedSnapshot = m.getValue();
  emit("readerEditDirtyChange", false);
}

/** 只读 / 编辑：切换 Monaco「阅读优化 chrome」与原生编辑 chrome（字体与配色仍走共享逻辑） */
function applyReaderMonacoModeOptions(editMode: boolean) {
  editor.value?.updateOptions(
    buildReaderMonacoModeEditorOptions(
      editMode,
      props.readerEditShowLineNumbers,
      props.readerEditMinimap,
      props.readerFullscreen,
    ),
  );
}

async function loadReaderEditFromDisk() {
  const p = props.physicalReaderPath?.trim();
  if (!p || !window.colorTxt?.readWholeTextFile) return;
  const r = await window.colorTxt.readWholeTextFile(p);
  if (!r.ok) {
    await appAlert(r.message);
    emit("readerEditLoadFailed");
    return;
  }
  const m = model.value;
  const e = editor.value;
  if (!m || !e) return;
  const restoreAnchor =
    props.readerEditRestoreAnchor ??
    (() => {
      const endDisplay = Math.max(1, Math.floor(getViewportEndLine()));
      const rawP =
        typeof props.ebookDisplayLineToPhysical === "function"
          ? props.ebookDisplayLineToPhysical(endDisplay)
          : endDisplay;
      return {
        physicalLine: Math.max(1, Math.floor(rawP)),
        wrappedLineIndex: 0,
      };
    })();
  disposeEbookInternalLinks();
  await applyEmbeddedImageAnchors(null);
  readerEditSuppressDirty = true;
  m.setValue(r.text);
  readerEditLoadedPhysicalKey = p;
  applyReaderMonacoModeOptions(true);
  teardownReaderEditContentListener();
  readerEditContentDisposable = m.onDidChangeContent(() => {
    onReaderEditModelContentChange();
  });
  const emitReaderEditLoadedAfterViewport = () => {
    sealReaderEditBaseline();
    readerEditSuppressDirty = false;
    emit("readerEditLoaded", { encoding: r.encoding });
    void nextTick(() => emitReaderEditCursorStatus());
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void restoreViewportToRestoreAnchor(restoreAnchor).then(() => {
        emitReaderEditLoadedAfterViewport();
      });
    });
  });
}

function markReaderEditSaved() {
  sealReaderEditBaseline();
}

function applyEditLineRangePatch(
  startLine: number,
  endLine: number,
  text: string,
): boolean {
  const m = model.value;
  const e = editor.value;
  if (!m || !e || !props.readerEditMode) {
    return false;
  }
  const sl = Math.max(1, Math.min(startLine, m.getLineCount()));
  const el = Math.max(sl, Math.min(endLine, m.getLineCount()));
  const range = new monaco.Range(
    sl,
    1,
    el,
    m.getLineMaxColumn(el),
  );
  if (text === m.getValueInRange(range)) return false;
  m.pushEditOperations(
    e.getSelections(),
    [{ range, text, forceMoveMarkers: true }],
    () => null,
  );
  return true;
}

function getSelectionRange(): monaco.Range | null {
  const e = editor.value;
  if (!e) return null;
  const sel = e.getSelection();
  if (!sel) return null;
  return monaco.Range.lift(sel);
}

/** 智能排版进行中：选中当前分段，并将分段末行贴齐视口底 */
function revealSmartFormatSegment(startLine: number, endLine: number): void {
  const e = editor.value;
  const m = model.value;
  if (!e || !m || !props.readerEditMode) return;

  const apply = () => {
    const lineCount = m.getLineCount();
    if (lineCount < 1) return;
    const sl = Math.max(1, Math.min(Math.floor(startLine), lineCount));
    const el = Math.max(sl, Math.min(Math.floor(endLine), lineCount));
    const selection = new monaco.Selection(
      sl,
      1,
      el,
      m.getLineMaxColumn(el),
    );
    e.layout();
    scrollLineToBottom(el, true);
    e.setSelection(selection);
    e.focus();
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(apply);
  });
}

/** 排版预览「应用」写回后：选中写回范围，并将末行贴齐视口底 */
function focusSmartFormatAppliedRange(
  startLine: number,
  patchedText: string,
): void {
  const m = model.value;
  const e = editor.value;
  if (!m || !e || !props.readerEditMode) return;

  const apply = () => {
    const lineCount = m.getLineCount();
    if (lineCount < 1) return;
    const sl = Math.max(1, Math.min(Math.floor(startLine), lineCount));
    const insertedLines = countLinesInText(patchedText);
    if (insertedLines < 1) {
      e.setPosition({ lineNumber: sl, column: 1 });
      e.focus();
      return;
    }
    const el = Math.max(sl, Math.min(sl + insertedLines - 1, lineCount));
    const selection = new monaco.Selection(
      sl,
      1,
      el,
      m.getLineMaxColumn(el),
    );
    e.layout();
    e.setSelection(selection);
    scrollLineToBottom(el, true);
    e.setSelection(selection);
    e.focus();
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(apply);
  });
}

function setSmartFormatRunning(lock: boolean): void {
  smartFormatRunning.value = lock;
  const e = editor.value;
  if (!e || !props.readerEditMode) return;
  e.updateOptions({ readOnly: lock });
  if (!lock) applyReaderMonacoModeOptions(true);
}

/** 编辑模式格式化整篇替换（`setValue` 比 `executeEdits` 更快，但会清空撤销栈，不支持撤销）。 */
function setModelTextIfChanged(text: string): boolean {
  const m = model.value;
  if (!m) return false;
  if (text === m.getValue()) return false;
  m.setValue(text);
  return true;
}

function resolveDisplayLineToPhysical(displayLine: number): number {
  if (props.readerEditMode) {
    return Math.max(1, Math.floor(displayLine));
  }
  const map =
    typeof props.ebookDisplayLineToPhysical === "function"
      ? props.ebookDisplayLineToPhysical
      : (d: number) => d;
  return Math.max(1, Math.floor(map(displayLine)));
}

function captureViewportRestoreAnchor(): ReaderViewportRestoreAnchor | null {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return null;
  return captureReaderViewportRestoreAnchor(e, m, resolveDisplayLineToPhysical);
}

function restoreViewportToRestoreAnchor(
  anchor: ReaderViewportRestoreAnchor,
  displayLineToPhysicalLine?: readonly number[],
): Promise<void> {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return Promise.resolve();

  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        beginProgrammaticScroll();
        const scrollTop = computeScrollTopForReaderViewportRestoreAnchor(
          e,
          m,
          anchor,
          displayLineToPhysicalLine,
        );
        if (scrollTop != null) {
          e.setScrollTop(scrollTop, monacoScrollType(false));
          const displayLine = resolveDisplayLineForViewportRestore(
            anchor.physicalLine,
            m.getLineCount(),
            displayLineToPhysicalLine,
          );
          e.setPosition({ lineNumber: displayLine, column: 1 });
        } else if (anchor.physicalLine >= m.getLineCount()) {
          scrollToBottom(false);
        } else {
          jumpToLine(1, false);
        }
        void nextTick(() => {
          normalizeScrollAfterEmbeddedViewZones();
          emitProbeLine(false);
          e.focus();
          resolve();
        });
      });
    });
  });
}

function readerFileIsMarkdown(): boolean {
  const p = props.physicalReaderPath ?? props.readerFilePath ?? "";
  return p ? isMarkdownFilePath(p) : false;
}

function smartFormatPostProcessContext(): SmartFormatPostProcessContext {
  const isMarkdown = readerFileIsMarkdown();
  return {
    chapterMinCharCount: props.chapterMinCharCount,
    isMarkdown,
    preserveMarkdownSourceLines: props.readerEditMode && isMarkdown,
    preservePhysicalSourceLines: props.readerEditMode,
  };
}

function readerFormatOptions(
  overrides: Partial<ReaderDisplayFormatOptions> = {},
): ReaderDisplayFormatOptions {
  const ctx = smartFormatPostProcessContext();
  return {
    compressBlankLines: false,
    compressBlankKeepOneBlank: false,
    leadIndentFullWidth: false,
    minCharCount: ctx.chapterMinCharCount,
    isMarkdown: ctx.isMarkdown,
    preserveMarkdownSourceLines: ctx.preserveMarkdownSourceLines,
    preservePhysicalSourceLines: ctx.preservePhysicalSourceLines,
    ...overrides,
  };
}

async function applyEditFormat(
  format: (plain: string) => {
    text: string;
    displayLineToPhysicalLine?: readonly number[];
  },
): Promise<boolean> {
  const m = model.value;
  if (!m || !props.readerEditMode) return false;
  const anchor =
    captureViewportRestoreAnchor() ?? {
      physicalLine: resolveDisplayLineToPhysical(
        Math.max(1, Math.floor(getViewportEndLine())),
      ),
      wrappedLineIndex: 0,
    };
  const { text, displayLineToPhysicalLine } = format(m.getValue());
  if (!setModelTextIfChanged(text)) return false;
  emitReaderEditDirtyIfChanged();
  await restoreViewportToRestoreAnchor(anchor, displayLineToPhysicalLine);
  return true;
}

async function applyEditFormatAsync(
  format: (plain: string) => Promise<{
    text: string;
    displayLineToPhysicalLine?: readonly number[];
  }>,
): Promise<boolean> {
  const m = model.value;
  if (!m || !props.readerEditMode) return false;
  const anchor =
    captureViewportRestoreAnchor() ?? {
      physicalLine: resolveDisplayLineToPhysical(
        Math.max(1, Math.floor(getViewportEndLine())),
      ),
      wrappedLineIndex: 0,
    };
  const { text, displayLineToPhysicalLine } = await format(m.getValue());
  if (!setModelTextIfChanged(text)) return false;
  emitReaderEditDirtyIfChanged();
  await restoreViewportToRestoreAnchor(anchor, displayLineToPhysicalLine);
  return true;
}

async function applyEditFormatCompressBlankLines(
  keepOneBlank: boolean,
): Promise<boolean> {
  return applyEditFormat((plain) =>
    formatPhysicalPlainTextForReader(
      plain,
      readerFormatOptions({
        compressBlankLines: true,
        compressBlankKeepOneBlank: keepOneBlank,
      }),
    ),
  );
}

async function applyEditFormatLeadIndentFullWidth(): Promise<boolean> {
  return applyEditFormat((plain) =>
    formatPhysicalPlainTextForReader(
      plain,
      readerFormatOptions({ leadIndentFullWidth: true }),
    ),
  );
}

async function applyEditFormatTextConvertZh(
  mode: TextConvertZhMode,
): Promise<boolean> {
  return applyEditFormatAsync(async (plain) => ({
    text: await applyTextConvertZh(plain, mode),
  }));
}

async function applyEditFormatTextConvertLetters(
  mode: TextConvertWidthMode,
): Promise<boolean> {
  return applyEditFormat((plain) => ({
    text: applyTextConvertLetters(plain, mode),
  }));
}

async function applyEditFormatTextConvertDigits(
  mode: TextConvertWidthMode,
): Promise<boolean> {
  return applyEditFormat((plain) => ({
    text: applyTextConvertDigits(plain, mode),
  }));
}

function applySmartFormatReviewFormat(
  format: (plain: string) => string,
): boolean {
  if (!smartFormatReviewActive.value) return false;
  const modifiedEd = smartFormatDiffEditor.value?.getModifiedEditor();
  const m = modifiedEd?.getModel();
  if (!modifiedEd || !m) return false;
  const plain = m.getValue();
  const formatted = format(plain);
  if (formatted === plain) return false;
  modifiedEd.pushUndoStop();
  modifiedEd.executeEdits("smartFormatReviewFormat", [
    {
      range: m.getFullModelRange(),
      text: formatted,
    },
  ]);
  return true;
}

function applySmartFormatReviewCompressBlankLines(
  keepOneBlank: boolean,
): boolean {
  return applySmartFormatReviewFormat((plain) =>
    compressBlankLinesInText(plain, smartFormatPostProcessContext(), keepOneBlank),
  );
}

function applySmartFormatReviewLeadIndentFullWidth(): boolean {
  return applySmartFormatReviewFormat((plain) =>
    leadIndentFullWidthInText(plain, smartFormatPostProcessContext()),
  );
}

function applyEditFormatInLineRange(
  startLine: number,
  endLine: number,
  format: (plain: string) => string,
): boolean {
  const m = model.value;
  if (!m || !props.readerEditMode) return false;
  const sl = Math.max(1, Math.min(startLine, m.getLineCount()));
  const el = Math.max(sl, Math.min(endLine, m.getLineCount()));
  const parts: string[] = [];
  for (let ln = sl; ln <= el; ln++) {
    parts.push(m.getLineContent(ln));
  }
  const plain = parts.join("\n");
  const formatted = format(plain);
  if (formatted === plain) return false;
  return applyEditLineRangePatch(sl, el, formatted);
}

function applyEditFormatCompressBlankLinesInRange(
  startLine: number,
  endLine: number,
  keepOneBlank: boolean,
): boolean {
  return applyEditFormatInLineRange(startLine, endLine, (plain) =>
    compressBlankLinesInText(
      plain,
      smartFormatPostProcessContext(),
      keepOneBlank,
    ),
  );
}

function applyEditFormatLeadIndentFullWidthInRange(
  startLine: number,
  endLine: number,
): boolean {
  return applyEditFormatInLineRange(startLine, endLine, (plain) =>
    leadIndentFullWidthInText(plain, smartFormatPostProcessContext()),
  );
}

function getTxtrMonarchHighlightOptions(): TxtrMonarchHighlightOptions {
  return {
    enabled: props.monacoCustomHighlight,
    highlightColorsLength: props.highlightColors.length,
    highlightWordsByIndex: props.highlightWordsByIndex,
  };
}

/** 高亮词或开关变化时更新 Monarch；会触发 TokenizationRegistry 失效并重算 token */
function applyTxtrMonarchTokenizer() {
  monaco.languages.setMonarchTokensProvider(
    languageId,
    createTxtrTextMonarchLanguage(
      getTxtrMonarchHighlightOptions(),
      props.txtrDelimitedMatchCrossLine,
    ),
  );
}

function closeHighlightFloatUi() {
  readerAnn.closeToolbarUi();
}

watch(
  () => props.highlightColors,
  () => {
    applyReaderSyntaxFromProps();
  },
  { deep: true },
);

watch(
  () => props.lineationColors,
  () => {
    syncLineationColorStyles();
  },
  { deep: true },
);

watch(
  () => props.highlightWordsByIndex,
  () => {
    applyTxtrMonarchTokenizer();
  },
  { deep: true },
);

watch(
  () => props.monacoAdvancedWrapping,
  (advanced) => {
    setWrappingStrategyAdvanced(advanced);
  },
);

watch(
  () => props.monacoSmoothScrolling,
  (on) => {
    editor.value?.updateOptions({ smoothScrolling: on });
  },
);

watch(
  () =>
    [
      props.readerEditShowLineNumbers,
      props.readerEditMinimap,
      props.readerEditMode,
      props.readerFullscreen,
    ] as const,
  () => {
    if (!editor.value) return;
    applyReaderMonacoModeOptions(Boolean(props.readerEditMode));
    void nextTick(() => {
      editor.value?.layout();
    });
    syncMinimapCursorLineDecoration();
    syncChapterMinimapSectionHeaderDecorations();
  },
);

function syncStickyScrollToStreamState() {
  const ed = editor.value;
  if (!ed) return;
  ed.updateOptions({
    stickyScroll: { enabled: !props.streamLoading },
  });
}

/** 章节大纲/标题装饰已更新后，强制粘性条重绘以套用样式 */
function scheduleStickyChapterScrollRefresh() {
  if (props.streamLoading) return;
  const ed = editor.value;
  if (!ed) return;
  if (stickyChapterScrollRefreshRaf != null) {
    cancelAnimationFrame(stickyChapterScrollRefreshRaf);
  }
  stickyChapterScrollRefreshRaf = requestAnimationFrame(() => {
    stickyChapterScrollRefreshRaf = null;
    const e = editor.value;
    if (!e || props.streamLoading) return;
    refreshStickyChapterScrollWidget(e);
  });
}

watch(
  () => props.streamLoading,
  () => {
    syncStickyScrollToStreamState();
  },
);

/** 程序性滚动（跳转、复位等）期间，onDidScrollChange 仍触发，但不视为用户阅读滚动 */
let programmaticScrollDepth = 0;

function beginProgrammaticScroll() {
  programmaticScrollDepth++;
  window.setTimeout(() => {
    programmaticScrollDepth = Math.max(0, programmaticScrollDepth - 1);
  }, 500);
}

/** 与设置「平滑滚动」一致：关闭时一律立即滚动 */
function monacoScrollType(wantSmooth: boolean): monaco.editor.ScrollType {
  return wantSmooth && props.monacoSmoothScrolling
    ? monaco.editor.ScrollType.Smooth
    : monaco.editor.ScrollType.Immediate;
}

/**
 * 读盘按固定字节分块时，CRLF 常被拆成上一块以 \\r 结尾、下一块以 \\n 开头。
 * 若分两次 applyEdits，Monaco 会对 \\r 与 \\n 各计一行，中间多出一行空行。
 * 故将末尾孤立的 \\r 暂存，与下一段拼接后再写入；流结束再刷出孤立的 \\r（经典 Mac 换行）。
 */
let streamCarriageReturnPending = false;

function appendText(text: string) {
  const m = model.value;
  if (!m) return;
  let t = text;
  if (streamCarriageReturnPending) {
    streamCarriageReturnPending = false;
    t = `\r${t}`;
  }
  if (t.endsWith("\r\n")) {
    // 完整 CRLF，直接写入
  } else if (t.endsWith("\r")) {
    streamCarriageReturnPending = true;
    t = t.slice(0, -1);
  }
  if (!t) return;
  const endPos = m.getPositionAt(m.getValueLength());
  m.applyEdits([
    {
      range: new monaco.Range(
        endPos.lineNumber,
        endPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: t,
    },
  ]);
}

/** 流式读盘结束后一次性写入正文（分块时不再逐块 append，避免重复着色与换行拼接问题） */
async function setFullText(text: string, opts?: { heavy?: boolean }) {
  streamCarriageReturnPending = false;
  const m = model.value;
  const e = editor.value;
  if (!m || !e) return;
  const heavy = opts?.heavy === true;
  if (heavy) {
    setReaderSyntaxHighlightEnabled(
      monaco,
      false,
      props.readerSurfaceLight,
      props.readerSurfaceDark,
      props.highlightColors,
    );
  }
  /** `setValue` 整文替换会使行内装饰失效；须使下次 `setChapters` 强制重建（仅切换行首缩进时行号不变） */
  lastChapterTitleDecorationsLineKey = "";
  if (heavy) {
    const langId = m.getLanguageId();
    const nextModel = monaco.editor.createModel(
      text,
      langId,
      monaco.Uri.parse(`colortxt-reader://${Date.now()}`),
    );
    e.setModel(nextModel);
    model.value = nextModel;
    m.dispose();
    annotationDecorationsCollection.value?.clear();
    annotationDecorationsCollection.value = e.createDecorationsCollection();
  } else {
    m.setValue(text);
  }
  await yieldToUi();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
  if (heavy && props.monacoCustomHighlight) {
    window.setTimeout(() => applyReaderSyntaxFromProps(), 0);
  }
}

function flushStreamCarriageReturn() {
  if (!streamCarriageReturnPending) return;
  streamCarriageReturnPending = false;
  const m = model.value;
  if (!m) return;
  const endPos = m.getPositionAt(m.getValueLength());
  m.applyEdits([
    {
      range: new monaco.Range(
        endPos.lineNumber,
        endPos.column,
        endPos.lineNumber,
        endPos.column,
      ),
      text: "\r",
    },
  ]);
}

/** 流结束时修正最后一行：无结尾换行时该行此前按原文缓冲，此处统一行首缩进 */
function normalizeLastLineLeadIndent() {
  const m = model.value;
  if (!m) return;
  const ln = m.getLineCount();
  if (ln < 1) return;
  const line = m.getLineContent(ln);
  const next = applyLeadIndentFullWidth(line);
  if (next === line) return;
  m.applyEdits([
    {
      range: new monaco.Range(ln, 1, ln, line.length + 1),
      text: next,
    },
  ]);
}

function cancelImageViewZoneScrollRender() {
  if (imageViewZoneScrollRenderRaf !== null) {
    cancelAnimationFrame(imageViewZoneScrollRenderRaf);
    imageViewZoneScrollRenderRaf = null;
  }
}

function disposeImageViewZones() {
  cancelImageViewZoneScrollRender();
  const e = editor.value;
  if (e && imageViewZoneIds.value.length > 0) {
    removeViewZonesById(e, imageViewZoneIds.value);
  }
  imageViewZoneIds.value = [];
}

function disposeEbookLinkIconStyles() {
  const el = document.getElementById(EBOOK_LINK_ICON_STYLE_ID);
  if (el) el.textContent = "";
}

function hashIconRelForCssClass(iconRel: string): string {
  let h = 5381;
  for (let i = 0; i < iconRel.length; i++) {
    h = ((h << 5) + h) ^ iconRel.charCodeAt(i)!;
  }
  return (h >>> 0).toString(36);
}

function ensureEbookLinkIconStyleElement(): HTMLStyleElement {
  let el = document.getElementById(
    EBOOK_LINK_ICON_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = EBOOK_LINK_ICON_STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

async function applyEbookLinkIconStyles(
  iconRels: readonly string[],
  convertedTxtAbsPath: string,
): Promise<Map<string, string>> {
  const relToClass = new Map<string, string>();
  const rules: string[] = [];
  const unique = [...new Set(iconRels.filter((r) => r.trim().length > 0))];
  for (const iconRel of unique) {
    const absPath = resolveMarkdownAssetAbsPath(iconRel, convertedTxtAbsPath);
    const url = await window.colorTxt.pathToReadableLocalUrl(absPath);
    if (!url) continue;
    const hash = hashIconRelForCssClass(iconRel);
    relToClass.set(iconRel, hash);
    const safeUrl = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    rules.push(
      `.monaco-editor .readerEbookLinkIcon--${hash}::before { background-image: url("${safeUrl}"); }`,
    );
  }
  ensureEbookLinkIconStyleElement().textContent = rules.join("\n");
  return relToClass;
}

function teardownEbookLinkViewportDecorSync() {
  if (ebookLinkViewportDecorSyncTimer != null) {
    clearTimeout(ebookLinkViewportDecorSyncTimer);
    ebookLinkViewportDecorSyncTimer = null;
  }
  ebookLinkScrollDecorDisposable?.dispose();
  ebookLinkScrollDecorDisposable = null;
  ebookLinkViewportDecorLastKey = "";
  ebookLinkDecorIconRelToClass = new Map();
}

function disposeEbookInternalLinks() {
  const e = editor.value;
  if (e && ebookInternalLinkDecorationIds.length > 0) {
    e.deltaDecorations(ebookInternalLinkDecorationIds, []);
    ebookInternalLinkDecorationIds = [];
  }
  teardownEbookLinkViewportDecorSync();
  disposeEbookLinkIconStyles();
  ebookInternalLinkHitCount.value = 0;
  ebookInternalLinkHitsByLine.value = new Map();
  ebookAnchorIdToPhysicalLine.value = new Map();
  ebookAnchorLookupCache = null;
  ebookLeadingLinkLabelsByDisplayLine.value = new Map();
}

function getEbookLinkViewportLineBounds(
  ed: monaco.editor.IStandaloneCodeEditor,
): { lo: number; hi: number } | null {
  const m = ed.getModel();
  if (!m) return null;
  const ranges = ed.getVisibleRanges();
  if (ranges.length === 0) return null;
  let lo = ranges[0]!.startLineNumber;
  let hi = ranges[ranges.length - 1]!.endLineNumber;
  for (const r of ranges) {
    lo = Math.min(lo, r.startLineNumber);
    hi = Math.max(hi, r.endLineNumber);
  }
  const buf = EBOOK_LINK_VIEWPORT_DECORATION_BUFFER_LINES;
  return {
    lo: Math.max(1, lo - buf),
    hi: Math.min(m.getLineCount(), hi + buf),
  };
}

function resolveFootnoteLineTextForEbookHover(
  targetId: string,
): string | undefined {
  const phys = getEbookAnchorPhysicalLine(targetId);
  if (phys == null) return undefined;
  const toDisplay = props.ebookAnchorPhysicalToDisplay;
  if (!toDisplay) return undefined;
  const displayLine = toDisplay(phys);
  const m = model.value;
  if (!m || displayLine < 1 || displayLine > m.getLineCount()) {
    return undefined;
  }
  return extractMdFootnoteHoverTextFromLine(m.getLineContent(displayLine));
}

function buildEbookLinkDecorationsForViewport(
  lo: number,
  hi: number,
  hitsByLine: Map<number, MdCompactLinkHit[]>,
  relToClass: Map<string, string>,
): monaco.editor.IModelDeltaDecoration[] {
  const decs: monaco.editor.IModelDeltaDecoration[] = [];
  for (let line = lo; line <= hi; line++) {
    const hits = hitsByLine.get(line);
    if (!hits?.length) continue;
    for (const h of hits) {
      let inlineClassName: string;
      if (h.builtinLinkIcon) {
        inlineClassName =
          "readerEbookLinkIcon readerEbookLinkIcon--builtin-link";
      } else {
        const iconRel = h.iconRel?.trim();
        const iconHash =
          iconRel && relToClass.has(iconRel)
            ? relToClass.get(iconRel)
            : undefined;
        if (iconRel && iconHash) {
          inlineClassName = `readerEbookLinkIcon readerEbookLinkIcon--${iconHash}`;
        } else if (iconRel) {
          inlineClassName =
            "readerEbookLinkIcon readerEbookLinkIcon--builtin-link";
        } else if (h.externalUrl?.trim()) {
          inlineClassName = "readerEbookExternalLink";
        } else {
          inlineClassName = "readerEbookInternalLink";
        }
      }
      decs.push({
        range: new monaco.Range(
          line,
          h.startColumn,
          line,
          h.endColumnExclusive,
        ),
        options: {
          inlineClassName,
          hoverMessage: {
            value: mdLinkDecorationHoverMessage(h, {
              resolveFootnoteLineText: resolveFootnoteLineTextForEbookHover,
            }),
          },
        },
      });
    }
  }
  return decs;
}

function syncEbookLinkViewportDecorationsNow() {
  const ed = editor.value;
  if (!ed || ebookInternalLinkHitCount.value === 0) return;
  const bounds = getEbookLinkViewportLineBounds(ed);
  if (!bounds) return;
  const key = `${bounds.lo}:${bounds.hi}`;
  if (
    key === ebookLinkViewportDecorLastKey &&
    ebookInternalLinkDecorationIds.length > 0
  ) {
    return;
  }
  ebookLinkViewportDecorLastKey = key;
  const decs = buildEbookLinkDecorationsForViewport(
    bounds.lo,
    bounds.hi,
    ebookInternalLinkHitsByLine.value,
    ebookLinkDecorIconRelToClass,
  );
  ebookInternalLinkDecorationIds = ed.deltaDecorations(
    ebookInternalLinkDecorationIds,
    decs,
  );
}

function scheduleEbookLinkViewportDecorSync(immediate = false) {
  if (immediate) {
    if (ebookLinkViewportDecorSyncTimer != null) {
      clearTimeout(ebookLinkViewportDecorSyncTimer);
      ebookLinkViewportDecorSyncTimer = null;
    }
    syncEbookLinkViewportDecorationsNow();
    return;
  }
  if (ebookLinkViewportDecorSyncTimer != null) {
    clearTimeout(ebookLinkViewportDecorSyncTimer);
  }
  ebookLinkViewportDecorSyncTimer = setTimeout(() => {
    ebookLinkViewportDecorSyncTimer = null;
    syncEbookLinkViewportDecorationsNow();
  }, EBOOK_LINK_VIEWPORT_DECOR_SYNC_MS);
}

async function ensureEbookLinkIconStylesForHits(
  hitsByLine: Map<number, MdCompactLinkHit[]>,
): Promise<void> {
  const iconRelSet = new Set<string>();
  for (const hits of hitsByLine.values()) {
    for (const h of hits) {
      const ir = h.iconRel?.trim();
      if (ir) iconRelSet.add(ir);
    }
  }
  const txtPath = props.physicalReaderPath?.trim();
  if (iconRelSet.size > 0 && txtPath) {
    ebookLinkDecorIconRelToClass = await applyEbookLinkIconStyles(
      [...iconRelSet],
      txtPath,
    );
  } else {
    ebookLinkDecorIconRelToClass = new Map();
  }
}

function bindEbookLinkViewportDecorScrollSync(
  ed: monaco.editor.IStandaloneCodeEditor,
) {
  ebookLinkScrollDecorDisposable?.dispose();
  ebookLinkScrollDecorDisposable = ed.onDidScrollChange(() => {
    scheduleEbookLinkViewportDecorSync();
  });
}

function getEbookAnchorLookupCache(): EbookAnchorLookupCache | null {
  const map = ebookAnchorIdToPhysicalLine.value;
  if (map.size === 0) {
    ebookAnchorLookupCache = null;
    return null;
  }
  if (!ebookAnchorLookupCache) {
    ebookAnchorLookupCache = buildEbookAnchorLookupCache(map);
  }
  return ebookAnchorLookupCache;
}

function getEbookAnchorPhysicalLine(targetId: string): number | undefined {
  const cache = getEbookAnchorLookupCache();
  if (!cache) return undefined;
  return lookupEbookAnchorPhysicalLineCached(cache, targetId);
}

function getEbookLeadingLinkLabelsByDisplayLine(): ReadonlyMap<
  number,
  readonly string[]
> {
  return ebookLeadingLinkLabelsByDisplayLine.value;
}

function setPendingEbookInternalLinkSidecar(
  sidecar: MdInternalLinkSidecar | null,
) {
  pendingEbookSidecar = sidecar;
}

function shiftPendingEbookSidecarForDeletedDisplayLines(
  deletedDisplayLinesDesc: readonly number[],
) {
  if (!pendingEbookSidecar || deletedDisplayLinesDesc.length === 0) return;
  shiftMdInternalLinkSidecarDisplayLines(
    pendingEbookSidecar,
    deletedDisplayLinesDesc,
  );
}

function ebookCompactHitRange(
  lineNumber: number,
  hit: MdCompactLinkHit,
): monaco.Range {
  return new monaco.Range(
    lineNumber,
    hit.startColumn,
    lineNumber,
    hit.endColumnExclusive,
  );
}

function tryJumpEbookInternalLinkFromPoint(
  clientX: number,
  clientY: number,
): boolean {
  const ed = editor.value;
  const m = model.value;
  if (!ed || !m || ebookInternalLinkHitCount.value === 0) return false;
  const pos = positionFromClientPoint(ed, clientX, clientY);
  if (!pos) return false;
  const lineHits = ebookInternalLinkHitsByLine.value.get(pos.lineNumber);
  if (!lineHits?.length) return false;
  const mapPhys =
    props.ebookAnchorPhysicalToDisplay ?? ((n: number) => Math.max(1, n));
  for (const h of lineHits) {
    const hitRange = ebookCompactHitRange(pos.lineNumber, h);
    if (!hitRange.containsPosition(pos)) continue;
    if (!clientXWithinSingleLineModelRange(ed, m, hitRange, clientX)) continue;
    const externalUrl = h.externalUrl?.trim();
    if (externalUrl && isAllowedMdExternalUrl(externalUrl)) {
      void window.colorTxt.openExternal(externalUrl);
      return true;
    }
    const phys = getEbookAnchorPhysicalLine(h.targetId);
    if (phys == null) continue;
    beginProgrammaticScroll();
    jumpToBookmarkLine(mapPhys(phys), true);
    return true;
  }
  return false;
}

function countEbookLinkHits(
  hitsByLine: Map<number, MdCompactLinkHit[]>,
): number {
  let n = 0;
  for (const hits of hitsByLine.values()) n += hits.length;
  return n;
}

/**
 * 点击在 `editorHost` 捕获阶段统一处理；装饰仅注册视口 ± 缓冲行（滚动时增量替换）。
 */
async function installEbookInternalLinkSidecar(
  sidecar: MdInternalLinkSidecar,
) {
  const ed = editor.value;
  if (!ed) return;
  ebookLeadingLinkLabelsByDisplayLine.value =
    sidecar.leadingMdLinkLabelsByDisplayLine;
  ebookAnchorIdToPhysicalLine.value = sidecar.idToPhysicalLine;
  ebookAnchorLookupCache = null;

  const hitsByLine = sidecar.hitsByDisplayLine;
  if (hitsByLine.size === 0) return;

  ebookInternalLinkHitCount.value = countEbookLinkHits(hitsByLine);
  ebookInternalLinkHitsByLine.value = hitsByLine;

  await ensureEbookLinkIconStylesForHits(hitsByLine);
  await yieldToUi();
  if (editor.value !== ed) return;

  bindEbookLinkViewportDecorScrollSync(ed);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scheduleEbookLinkViewportDecorSync(true);
    });
  });
}

/**
 * 任意 `.md`：剥离 `<span id>` / 内部 MD 链接语法，安装侧车装饰。
 */
async function applyMarkdownInternalLinks() {
  const prefetchedSidecar = pendingEbookSidecar;
  pendingEbookSidecar = null;
  disposeEbookInternalLinks();
  if (prefetchedSidecar) {
    await installEbookInternalLinkSidecar(prefetchedSidecar);
    return;
  }

  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  const raw = m.getValue();
  if (!lineContainsMdStripLink(raw) && !/<span\s+id=/i.test(raw)) return;
  beginProgrammaticScroll();
  const normalized = raw.replace(/\r\n/g, "\n");
  let {
    text,
    outLines,
    idToPhysicalLine,
    linkOccurrences,
    leadingMdLinkLabelsByLine,
  } = stripMdInternalLinksFromText(normalized);
  ebookLeadingLinkLabelsByDisplayLine.value = leadingMdLinkLabelsByLine;
  if (
    text === normalized &&
    idToPhysicalLine.size === 0 &&
    linkOccurrences.length === 0
  ) {
    return;
  }
  if (props.compressBlankLines) {
    const toPhys =
      props.ebookDisplayLineToPhysical ??
      ((n: number) => Math.max(1, Math.floor(n)));
    const idMap = new Map<string, number>();
    for (const [id, displayLine] of idToPhysicalLine) {
      idMap.set(id, toPhys(displayLine));
    }
    idToPhysicalLine = idMap;
  }
  const lc = m.getLineCount();
  if (text !== normalized && outLines.length === lc) {
    m.applyEdits([
      {
        range: m.getFullModelRange(),
        text,
      },
    ]);
  } else if (text !== normalized) {
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    for (let lineNumber = 1; lineNumber <= lc; lineNumber++) {
      const i = lineNumber - 1;
      const nextLine = outLines[i];
      if (nextLine === undefined) break;
      if (m.getLineContent(lineNumber) !== nextLine) {
        edits.push({
          range: new monaco.Range(
            lineNumber,
            1,
            lineNumber,
            m.getLineMaxColumn(lineNumber),
          ),
          text: nextLine,
        });
      }
    }
    if (edits.length >= MD_LINK_BULK_STRIP_EDIT_THRESHOLD) {
      m.applyEdits([
        {
          range: m.getFullModelRange(),
          text,
        },
      ]);
    } else if (edits.length > 0) {
      m.applyEdits(edits);
    }
  }
  const hitsByDisplayLine = new Map<number, MdCompactLinkHit[]>();
  const lineCount = Math.max(1, m.getLineCount());
  for (const occ of linkOccurrences) {
    const dl = Math.min(lineCount, Math.max(1, occ.physicalLine));
    const hit: MdCompactLinkHit = {
      startColumn: occ.startColumn,
      endColumnExclusive: occ.endColumnExclusive,
      targetId: occ.targetId,
      iconRel: occ.iconRel,
      label: occ.label,
      hoverTip: occ.hoverTip,
      builtinLinkIcon: occ.builtinLinkIcon,
      externalUrl: occ.externalUrl,
    };
    const bucket = hitsByDisplayLine.get(dl);
    if (bucket) bucket.push(hit);
    else hitsByDisplayLine.set(dl, [hit]);
  }
  await installEbookInternalLinkSidecar({
    idToPhysicalLine,
    hitsByDisplayLine,
    leadingMdLinkLabelsByDisplayLine: new Map(
      [...leadingMdLinkLabelsByLine.entries()].map(([k, v]) => [
        k,
        [...v],
      ]),
    ),
  });
}

function isMarkdownReaderPath(filePath: string): boolean {
  return /\.md$/i.test(filePath.trim());
}

async function applyEmbeddedImageAnchors(
  convertedTxtAbsPath: string | null,
): Promise<ReplaceImgAnchorsResult> {
  disposeImageViewZones();
  imageLightboxSrc.value = "";
  const p = convertedTxtAbsPath?.trim();
  if (!p) return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return { zoneIds: [], deletedOriginalLineNumbersDesc: [] };
  const raw = m.getValue();
  const isMd = !props.readerEditMode && isMarkdownReaderPath(p);
  const result = await replaceImgAnchorLinesWithViewZones(monaco, e, p, {
    zoneHeightPx: 100,
    sourceText: raw,
    blockImages: isMd ? collectBlockMarkdownImageLines(raw, p) : [],
  });
  imageViewZoneIds.value = result.zoneIds;
  return result;
}

function clear(opts?: ReaderClearOptions) {
  disposeEbookInternalLinks();
  disposeAnnotationDecorations();
  pendingEbookSidecar = null;
  disposeImageViewZones();
  imageLightboxSrc.value = "";
  streamCarriageReturnPending = false;
  lastChapterTitleDecorationsLineKey = "";
  chaptersSnapshot = [];

  const e = editor.value;
  const prevModel = model.value;
  chapterTitleDecorationsCollection.value?.clear();
  inlineSearch.clearInlineSearchState();
  annotationDecorationsCollection.value?.clear();
  voiceReadDecorationsCollection.value?.clear();
  minimapCursorLineDecorationsCollection.value?.clear();
  chapterMinimapDecorationsCollection.value?.clear();

  e?.updateOptions({ stickyScroll: { enabled: false } });

  if (e && prevModel) {
    const next = monaco.editor.createModel("", languageId);
    e.setModel(next);
    prevModel.dispose();
    model.value = next;
    chapterTitleDecorationsCollection.value = e.createDecorationsCollection();
    inlineSearchDecorationsCollection.value = e.createDecorationsCollection();
    annotationDecorationsCollection.value = e.createDecorationsCollection();
    voiceReadDecorationsCollection.value = e.createDecorationsCollection();
    minimapCursorLineDecorationsCollection.value =
      e.createDecorationsCollection();
    chapterMinimapDecorationsCollection.value =
      e.createDecorationsCollection();
    e.setPosition({ lineNumber: 1, column: 1 });
    e.setScrollTop(0);
    e.layout();
    bindAnnotationScrollSync(e);
  } else {
    prevModel?.setValue("");
  }

  if (!opts?.keepStickyHiddenForStream) {
    syncStickyScrollToStreamState();
  }
}

function setChapters(chapters: ChapterStickyLine[]) {
  const m = model.value;
  const collection = chapterTitleDecorationsCollection.value;
  if (!m || !collection) return;

  chaptersSnapshot = chapters
    .slice()
    .sort(
      (a, b) =>
        (a.tocOrder ?? a.lineNumber) - (b.tocOrder ?? b.lineNumber) ||
        a.lineNumber - b.lineNumber,
    )
    .map((c) => ({
      lineNumber: c.lineNumber,
      title: chapterTitleForDisplay(c.title),
      headingLevel: c.headingLevel,
      tocOrder: c.tocOrder,
    }));

  const maxLine = m.getLineCount();
  let chapterTitleDisplayEdited = false;
  /** 编辑态仅同步章节元数据，勿 applyEdits 剥标题行首空白（会误触 dirty） */
  if (!props.readerEditMode) {
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    const normalizedChapterLines = new Set<number>();
    const linkColumnShiftByLine = new Map<number, number>();
    for (const ch of chaptersSnapshot) {
      const ln = ch.lineNumber;
      if (ln < 1 || ln > maxLine || normalizedChapterLines.has(ln)) continue;
      normalizedChapterLines.add(ln);
      const original = m.getLineContent(ln);
      let line = original;
      let colShift = 0;
      if (props.fileIsMarkdown) {
        const atxCols = atxHeadingPrefixLength(line);
        const withoutAtx = formatMarkdownHeadingLineForDisplay(line);
        if (atxCols > 0 && withoutAtx !== line && line.slice(atxCols) === withoutAtx) {
          colShift += atxCols;
          line = withoutAtx;
        } else {
          line = withoutAtx;
        }
      }
      const n = leadingWhitespaceColumnCount(line);
      if (n > 0) {
        line = line.slice(n);
        colShift += n;
      }
      if (line !== original) {
        if (colShift > 0) linkColumnShiftByLine.set(ln, colShift);
        edits.push({
          range: new monaco.Range(ln, 1, ln, m.getLineMaxColumn(ln)),
          text: line,
        });
      }
    }
    if (edits.length > 0) {
      chapterTitleDisplayEdited = true;
      m.applyEdits(edits);
      if (ebookInternalLinkHitCount.value > 0) {
        const hitsMap = ebookInternalLinkHitsByLine.value;
        for (const [ln, strippedCols] of linkColumnShiftByLine) {
          const hits = hitsMap.get(ln);
          if (!hits?.length) continue;
          for (const hit of hits) {
            shiftMdLinkHitColumns(hit, -strippedCols);
          }
        }
        ebookInternalLinkHitsByLine.value = new Map(hitsMap);
        ebookLinkViewportDecorLastKey = "";
        scheduleEbookLinkViewportDecorSync(true);
      }
    } else if (chaptersSnapshot.length > 0) {
      // EPUB 等无标题行改写时亦须 bump 模型版本，否则粘性大纲不刷新
      const lc = m.getLineCount();
      const col = m.getLineMaxColumn(lc);
      m.applyEdits([
        {
          range: new monaco.Range(lc, col, lc, col),
          text: "",
        },
      ]);
    }
  }

  const maxAfter = m.getLineCount();
  for (const ch of chaptersSnapshot) {
    if (ch.title) continue;
    const ln = ch.lineNumber;
    if (ln < 1 || ln > maxAfter) continue;
    ch.title = chapterTitleForDisplay(m.getLineContent(ln));
  }
  for (const ch of chaptersSnapshot) {
    if (!ch.title) {
      ch.title = `第 ${ch.lineNumber} 行`;
    }
  }

  const sortedChapters = chaptersSnapshot
    .filter((c) => c.lineNumber >= 1 && c.lineNumber <= maxAfter)
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber);

  const lineKey = chapterLineNumbersKey(
    sortedChapters.map((c) => c.lineNumber),
  );
  /** 编辑态不加章节标题行内样式（scale/着色），避免改标题前后正文时 Monaco 渲染异常 */
  if (props.readerEditMode) {
    collection.clear();
    lastChapterTitleDecorationsLineKey = "";
    syncChapterMinimapSectionHeaderDecorations();
    notifyChapterStickyFoldingRanges?.();
    syncStickyScrollToStreamState();
    scheduleStickyChapterScrollRefresh();
    return;
  }
  syncChapterMinimapSectionHeaderDecorations();
  if (
    lineKey !== lastChapterTitleDecorationsLineKey ||
    chapterTitleDisplayEdited
  ) {
    collection.set(buildChapterTitleDecorations(monaco, m, chaptersSnapshot));
    lastChapterTitleDecorationsLineKey = lineKey;
  }
  notifyChapterStickyFoldingRanges?.();
  syncStickyScrollToStreamState();
  scheduleStickyChapterScrollRefresh();
  if (ebookInternalLinkHitCount.value > 0) {
    ebookLinkViewportDecorLastKey = "";
    scheduleEbookLinkViewportDecorSync(true);
  }
  requestAnimationFrame(() => {
    notifyChapterStickyFoldingRanges?.();
    scheduleStickyChapterScrollRefresh();
  });
}

function syncChapterMinimapSectionHeaderDecorations() {
  const col = chapterMinimapDecorationsCollection.value;
  const m = model.value;
  if (!col || !m) return;
  if (!props.readerEditMode || !props.readerEditMinimap) {
    col.clear();
    return;
  }
  col.set(buildChapterMinimapSectionHeaderDecorations(monaco, m, chaptersSnapshot));
}

function syncMinimapCursorLineDecoration() {
  const col = minimapCursorLineDecorationsCollection.value;
  const e = editor.value;
  const m = model.value;
  if (!col || !e || !m) return;
  if (!props.readerEditMode || !props.readerEditMinimap) {
    col.clear();
    return;
  }
  const selections = e.getSelections() ?? [];
  if (selections.some((s) => !s.isEmpty())) {
    col.clear();
    return;
  }
  const line = Math.max(1, Math.min(m.getLineCount(), e.getPosition()?.lineNumber ?? 1));
  col.set([
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        minimap: {
          color: getReaderMinimapCursorLineDecorColor(lastAppThemeName),
          position: monaco.editor.MinimapPosition.Inline,
        },
      },
    },
  ]);
}

function setTheme(themeName: string) {
  lastAppThemeName = themeName;
  syncMinimapCursorLineDecoration();
  if (themeName === "vs") {
    monaco.editor.setTheme("vs");
  } else if (builtInThemes.has(themeName)) {
    monaco.editor.setTheme(themeName);
  } else {
    monaco.editor.setTheme("vs-dark");
  }
  syncReaderMonacoOverflowHostTheme(themeName);
  forceOverviewRulerCanvasRepaint();
  if (smartFormatReviewActive.value) {
    requestAnimationFrame(() => layoutDiffEditor());
  }
}

/**
 * setTheme 后概览尺常走 Maybe 并跳过 Canvas border；通过 overviewRulerBorder 关→开
 * 触发 onConfigurationChanged → Needed，完整重绘左边线。
 */
function forceOverviewRulerCanvasRepaint() {
  const ed = editor.value;
  if (!ed) return;
  const wantBorder = buildReaderOverviewRulerBorder(
    Boolean(props.readerEditMode),
    props.readerFullscreen,
  );
  void nextTick(() => {
    ed.updateOptions({ overviewRulerBorder: false });
    if (!wantBorder) return;
    requestAnimationFrame(() => {
      ed.updateOptions({
        overviewRulerBorder: true,
      });
      ed.layout();
    });
  });
}

function setFontSize(fontSize: number) {
  const e = editor.value;
  if (!e) return;
  e.updateOptions(
    buildReaderEditorFontSizeUpdate({
      fontSize,
      lineHeightMultiple,
    }),
  );
  if (smartFormatReviewActive.value) {
    syncDiffEditorTypography();
  }
}

function setLineHeightMultiple(multiple: number) {
  lineHeightMultiple = multiple;
  const e = editor.value;
  if (!e) return;
  const fontSize = e.getOption(monaco.editor.EditorOption.fontSize);
  e.updateOptions(
    buildReaderEditorLineHeightUpdate({
      fontSize,
      lineHeightMultiple,
    }),
  );
  if (smartFormatReviewActive.value) {
    syncDiffEditorTypography();
  }
}

function setWrappingStrategyAdvanced(advanced: boolean) {
  editor.value?.updateOptions({
    wrappingStrategy: advanced ? "advanced" : "simple",
  });
}

function setFontFamily(fontFamily: string) {
  const e = editor.value;
  if (!e) return;

  currentFontFamily = fontFamily;
  e.updateOptions({ fontFamily: currentFontFamily });
  if (smartFormatReviewActive.value) {
    syncDiffEditorTypography();
  }

  // Ensure KingHwa webfont is loaded before applying to avoid fallback flashes.
  if (currentFontFamily.includes("KingHwa OldSong")) {
    const fontSize = e.getOption(monaco.editor.EditorOption.fontSize);
    void document.fonts?.load(`${fontSize}px "KingHwa OldSong"`).then(() => {
      e.updateOptions({ fontFamily: currentFontFamily });
      if (smartFormatReviewActive.value) {
        syncDiffEditorTypography();
      }
    });
  }
}

function resetToTop() {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  e.setPosition({ lineNumber: 1, column: 1 });
  e.revealLineInCenter(1, monacoScrollType(true));
  e.setScrollTop(0, monacoScrollType(true));
  queueMicrotask(() => {
    try {
      e.setPosition({ lineNumber: 1, column: 1 });
      e.setScrollTop(0, monacoScrollType(true));
    } catch {
      // ignore
    }
  });
}

/**
 * 将视口对齐到文档最顶（scrollTop=0）。
 * 首屏为 `afterLineNumber: 0` 的插图 View Zone 时，若用 `jumpToLine(1)` 会按正文第 1 行顶对齐，等于滚过插图，滚动条也不在顶。
 */
function scrollToDocumentStart(smooth = false) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const scrollType = monacoScrollType(smooth);
  e.layout();
  e.setScrollTop(0, scrollType);
  e.setPosition({ lineNumber: 1, column: 1 });
  e.focus();
}

/**
 * 将目标行顶对齐视口指定字高带；不移动光标、不抢焦点（编辑态章节导航等）。
 * @param anchorSlotFromTop 视口顶沿往下第几条字高带（1 = 贴顶）；省略则与历史行为一致（贴顶）。
 */
function scrollToLineNearTop(
  lineNumber: number,
  smooth = true,
  anchorSlotFromTop?: number,
) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = monacoScrollType(smooth);
  e.layout();
  e.revealLineNearTop(line, scrollType);
  let scrollTop = e.getTopForLineNumber(line);
  if (anchorSlotFromTop != null && anchorSlotFromTop >= 1) {
    const slotted = computeScrollTopForLineAtViewportSlot(
      e,
      line,
      anchorSlotFromTop,
    );
    if (slotted != null) scrollTop = slotted;
  }
  e.setScrollTop(Math.max(0, scrollTop), scrollType);
}

function jumpToLine(lineNumber: number, smooth = true) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  scrollToLineNearTop(lineNumber, smooth);
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, m.getLineCount())),
  );
  e.setPosition({ lineNumber: line, column: 1 });
  e.focus();
}

/** 搜索结果跳转：将目标行尽量居中显示 */
function jumpToLineCentered(lineNumber: number, smooth = true) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = monacoScrollType(smooth);
  e.layout();
  e.revealLineInCenter(line, scrollType);
  e.setPosition({ lineNumber: line, column: 1 });
  e.focus();
}

/** 语音朗读：自动换行块垂直居中滚动（不写光标位置、不抢焦点，避免只读模式出现闪烁 caret） */
function scrollModelLineBlockToViewportCenter(
  lineNumber: number,
  smooth = true,
) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = monacoScrollType(smooth);
  e.layout();
  const top = e.getTopForLineNumber(line);
  const bottom = e.getBottomForLineNumber(line);
  const blockCenter = (top + bottom) / 2;
  const layoutH = Math.max(1, e.getLayoutInfo().height);
  const maxTop = Math.max(0, e.getScrollHeight() - layoutH);
  const targetTop = Math.max(0, Math.min(maxTop, blockCenter - layoutH / 2));
  e.setScrollTop(targetTop, scrollType);
}

/** 视口内容区垂直中心对应的模型行（与暂停指引横线、{@link scrollModelLineBlockToViewportCenter} 同一套滚动坐标） */
function getModelLineAtViewportCenter(): number {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return 1;
  e.layout();
  const layout = e.getLayoutInfo();
  const layoutH = Math.max(1, layout.height);
  const targetY = Math.max(0, e.getScrollTop()) + layoutH / 2;
  const lc = Math.max(1, m.getLineCount());

  let lo = 1;
  let hi = lc;
  let seed = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = e.getTopForLineNumber(mid);
    if (!Number.isFinite(top)) break;
    if (top <= targetY) {
      seed = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  let best = seed;
  let bestDist = Infinity;
  const from = Math.max(1, seed - 1);
  const to = Math.min(lc, seed + 1);
  for (let line = from; line <= to; line++) {
    const top = e.getTopForLineNumber(line);
    const bottom = e.getBottomForLineNumber(line);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;
    const dist = Math.abs((top + bottom) / 2 - targetY);
    if (dist < bestDist) {
      bestDist = dist;
      best = line;
    }
  }
  return best;
}

function getViewportStartModelLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  return r ? Math.max(1, r.startLineNumber) : 1;
}

function setVoiceReadLineHighlight(lineNumber: number | null) {
  const col = voiceReadDecorationsCollection.value;
  const m = model.value;
  if (!col || !m) return;
  if (lineNumber == null || !Number.isFinite(lineNumber)) {
    voiceReadHighlightLine.value = null;
    col.clear();
    return;
  }
  const line = Math.max(1, Math.min(Math.floor(lineNumber), m.getLineCount()));
  voiceReadHighlightLine.value = line;
  col.set([
    {
      range: new monaco.Range(line, 1, line, m.getLineMaxColumn(line)),
      options: {
        isWholeLine: true,
        className: "readerVoiceReadCurrentLine",
        linesDecorationsClassName: "readerVoiceReadCurrentLineDecor",
      },
    },
  ]);
}

function suppressHighlightTipForProgrammaticSelection() {
  readerAnn.setSuppressToolbarUntilMs(Date.now() + 300);
  readerAnn.closeToolbarUi();
}

const inlineSearch = useReaderInlineSearch({
  editor,
  model,
  inlineSearchDecorationsCollection,
  beginProgrammaticScroll,
  monacoScrollType,
  suppressHighlightTipForProgrammaticSelection,
  onClearAllDecorations: () => {
    /** 清除所有装饰器（包括 Ctrl+F 的） */
    const e = editor.value;
    if (!e) return;
    /** 调用 Monaco 内部方法清除 Ctrl+F 的装饰器 */
    const findCtrl = e.getContribution("editor.contrib.findController") as {
      closeFindWidget?: () => void;
    } | null;
    if (findCtrl?.closeFindWidget) {
      findCtrl.closeFindWidget();
    } else {
      e.getAction("closeFindWidget")?.run();
    }
  },
});

/**
 * 书签列表跳转：目标行对齐视口第 2 条字高带，为单层黏性章节条留白。
 * 不并入 {@link jumpToLine}，避免会话恢复/章节导航产生额外偏移。
 */
function jumpToBookmarkLine(lineNumber: number, smooth = true) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = m.getLineCount();
  const line = Math.max(
    1,
    Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
  );
  const scrollType = monacoScrollType(smooth);
  e.layout();
  e.revealLineNearTop(line, scrollType);
  const scrollTop =
    computeScrollTopForLineAtViewportSlot(
      e,
      line,
      READER_BOOKMARK_JUMP_SLOT_FROM_TOP,
    ) ?? e.getTopForLineNumber(line);
  e.setScrollTop(Math.max(0, scrollTop), scrollType);
  e.setPosition({ lineNumber: line, column: 1 });
  e.focus();
}

/**
 * 与 {@link jumpToBookmarkLine} 对齐：当前滚动下，视口内容区上沿往下约「一行字高」处的逻辑行（Monaco 显示行号）。
 * 用于保存书签，使「记下的一行」与从书签列表跳回后光标所在行一致。
 */
function getBookmarkSaveAnchorDisplayLine(): number | null {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return null;
  e.layout();
  const lineHeightPx = e.getOption(monaco.editor.EditorOption.lineHeight);
  const scrollTop = Math.max(0, e.getScrollTop());
  const targetY = scrollTop + lineHeightPx;
  const lc = Math.max(1, m.getLineCount());
  let lo = 1;
  let hi = lc;
  let ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const top = e.getTopForLineNumber(mid);
    if (!Number.isFinite(top)) return null;
    if (top <= targetY) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, Math.min(ans, lc));
}

/**
 * 视口内首行（Monaco 显示行号，1-based）。
 * 用于 `viewportDisplayLineToPhysicalLine`：滤空时必须为真实显示行，不得 +1，否则物理行号会错位。
 */
function getViewportTopLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  return r?.startLineNumber ?? 1;
}

/** 当前视口可见行跨度（end-start，最小为 0） */
function getViewportLineSpan(): number {
  const e = editor.value;
  if (!e) return 0;
  const r = e.getVisibleRanges()[0];
  if (!r) return 0;
  return Math.max(0, r.endLineNumber - r.startLineNumber);
}

function getAllText(): string {
  return model.value?.getValue() ?? "";
}

/** Monaco 指定显示行（1-based）的文本，供物理行→显示行映射与正文比对 */
function getEditorLineContent(lineNumber: number): string {
  const m = model.value;
  if (!m) return "";
  const lc = m.getLineCount();
  const ln = Math.max(1, Math.min(Math.floor(lineNumber), lc));
  return m.getLineContent(ln);
}

function getSelectedText(): string {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return "";
  const sel = e.getSelection();
  if (!sel || sel.isEmpty()) return "";
  return m.getValueInRange(sel);
}

function getModelLineCount(): number {
  return model.value?.getLineCount() ?? 0;
}

function monacoPositionAfterPaste(
  start: monaco.Position,
  text: string,
): monaco.Position {
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  if (lines.length === 1) {
    return new monaco.Position(
      start.lineNumber,
      start.column + lines[0].length,
    );
  }
  return new monaco.Position(
    start.lineNumber + lines.length - 1,
    lines[lines.length - 1].length + 1,
  );
}

/** 菜单粘贴：Electron 下 `trigger(clipboardPasteAction)` 常无效，改读剪贴板后 executeEdits */
async function pasteClipboardIntoMonacoEditor(
  e: monaco.editor.ICodeEditor,
): Promise<void> {
  await nextTick();
  e.focus();
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!text) return;
  const m = e.getModel();
  const sel = e.getSelection();
  if (!m || !sel) return;
  const anchor = sel.getStartPosition();
  e.pushUndoStop();
  const ok = e.executeEdits("colortxt-context-paste", [
    { range: sel, text, forceMoveMarkers: true },
  ]);
  if (!ok) return;
  e.pushUndoStop();
  const end = monacoPositionAfterPaste(anchor, text);
  e.setSelection(monaco.Selection.fromPositions(end, end));
}

function closeEditorEditContextMenu() {
  editorEditContextMenuOpen.value = false;
}

function closeDiffReviewContextMenu() {
  diffReviewContextMenuOpen.value = false;
}

function onDiffReviewContextMenuSelect(id: string) {
  closeDiffReviewContextMenu();
  const diff = smartFormatDiffEditor.value;
  if (!diff) return;
  const e =
    diffReviewContextMenuSide.value === "original"
      ? diff.getOriginalEditor()
      : diff.getModifiedEditor();
  if (id === "cut") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCutAction", null);
    return;
  }
  if (id === "copy") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCopyAction", null);
    return;
  }
  if (id === "paste") {
    void pasteClipboardIntoMonacoEditor(e);
  }
}

function onEditorEditContextMenuSelect(id: string) {
  closeEditorEditContextMenu();
  if (smartFormatReviewActive.value) return;
  const e = editor.value;
  if (!e || smartFormatRunning.value) return;
  if (id === "cut") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCutAction", null);
    return;
  }
  if (id === "copy") {
    e.focus();
    e.trigger("keyboard", "editor.action.clipboardCopyAction", null);
    return;
  }
  if (id === "paste") {
    void pasteClipboardIntoMonacoEditor(e);
    return;
  }
  if (id === "ai-format-selection") {
    emit("aiSmartFormatSelection");
    return;
  }
  if (id === "ai-format-full") {
    emit("aiSmartFormatFull");
  }
}

const FIND_CONTROLLER_ID = "editor.contrib.findController";

function toggleFindWidget() {
  if (props.voiceReadBlocksFind) return;
  const e = editor.value;
  if (!e) return;
  const findCtrl = e.getContribution(FIND_CONTROLLER_ID) as {
    getState?: () => { isRevealed: boolean };
    closeFindWidget?: () => void;
  } | null;
  const revealed = findCtrl?.getState?.().isRevealed === true;
  e.focus();
  if (revealed) {
    /** Ctrl+F 关闭：不自动恢复内联搜索装饰器 */
    if (findCtrl?.closeFindWidget) {
      findCtrl.closeFindWidget();
      return;
    }
    e.getAction("closeFindWidget")?.run();
  } else {
    /** Ctrl+F 打开：清除并禁用内联搜索装饰器，避免颜色共存冲突 */
    inlineSearch.clearInlineSearchDecorations();
    props.beforeRevealFindWidget?.();
    e.getAction("actions.find")?.run();
  }
}

function isFindWidgetRevealed(): boolean {
  const e = editor.value;
  if (!e) return false;
  const findCtrl = e.getContribution(FIND_CONTROLLER_ID) as {
    getState?: () => { isRevealed: boolean };
  } | null;
  return findCtrl?.getState?.().isRevealed === true;
}

/** 全屏顶栏收起等场景：仅当查找栏已显示时关闭，不打开查找栏 */
function closeFindWidgetIfRevealed() {
  const e = editor.value;
  if (!e) return;
  const findCtrl = e.getContribution(FIND_CONTROLLER_ID) as {
    getState?: () => { isRevealed: boolean };
    closeFindWidget?: () => void;
  } | null;
  if (findCtrl?.getState?.().isRevealed !== true) return;
  if (findCtrl.closeFindWidget) {
    findCtrl.closeFindWidget();
    return;
  }
  e.getAction("closeFindWidget")?.run();
}

type FindControllerStartOpts = {
  forceRevealReplace: boolean;
  seedSearchStringFromSelection: "none" | "single" | "multiple";
  seedSearchStringFromNonEmptySelection: boolean;
  seedSearchStringFromGlobalClipboard: boolean;
  shouldFocus: number;
  shouldAnimate: boolean;
  updateSearchScope: boolean;
  loop: boolean;
};

/** 顶栏高亮词：先经书钉回调，再打开查找并填入高亮词（字面量），并跳到下一处匹配 */
function openFindWithSearchString(raw: string) {
  void openFindWithSearchStringAsync(raw);
}

async function openFindWithSearchStringAsync(raw: string) {
  if (props.voiceReadBlocksFind) return;
  const e = editor.value;
  const term = raw.trim();
  if (!e || !term) return;

  props.beforeRevealFindWidget?.();

  const findOpt = e.getOption(monaco.editor.EditorOption.find);
  const ctrl = e.getContribution(FIND_CONTROLLER_ID) as {
    start?: (
      opts: FindControllerStartOpts,
      newState?: Record<string, unknown>,
    ) => Promise<void>;
    moveToNextMatch?: () => boolean;
  } | null;

  e.focus();

  if (!ctrl?.start) {
    e.getAction("actions.find")?.run();
    e.trigger("colortxt", "editor.actions.findWithArgs", {
      searchString: term,
      isRegex: false,
      matchWholeWord: false,
      isCaseSensitive: false,
      preserveCase: false,
      findInSelection: false,
    });
    return;
  }

  await ctrl.start(
    {
      forceRevealReplace: false,
      seedSearchStringFromSelection: "none",
      seedSearchStringFromNonEmptySelection: false,
      seedSearchStringFromGlobalClipboard: false,
      shouldFocus: 1,
      shouldAnimate: false,
      updateSearchScope: false,
      loop: findOpt.loop,
    },
    {
      searchString: term,
      isReplaceRevealed: false,
      isRegex: false,
      wholeWord: false,
      matchCase: false,
      preserveCase: false,
    },
  );
  ctrl.moveToNextMatch?.();
}

function focusEditor() {
  editor.value?.focus();
}

function scrollByDeltaY(deltaY: number) {
  const e = editor.value;
  if (!e || !Number.isFinite(deltaY) || deltaY === 0) return;
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const nextTop = Math.max(0, Math.min(maxTop, e.getScrollTop() + deltaY));
  e.setScrollTop(nextTop, monacoScrollType(true));
}

/**
 * 将原生 wheel 交给 Monaco 内部滚动（与编辑区内触控板/滚轮一致）。
 * `delegateScrollFromMouseWheelEvent` 在运行时的 CodeEditorWidget 上存在，但未写入 monaco d.ts。
 */
function delegateEditorWheelFromBrowserEvent(ev: WheelEvent) {
  const e = editor.value;
  if (!e) return;
  const ed = e as monaco.editor.IStandaloneCodeEditor & {
    delegateScrollFromMouseWheelEvent?(browserEvent: WheelEvent): void;
  };
  ed.delegateScrollFromMouseWheelEvent?.(ev);
}

function scrollByLineStep(direction: -1 | 1) {
  const e = editor.value;
  if (!e) return;
  const lineHeight = Math.max(
    1,
    e.getOption(monaco.editor.EditorOption.lineHeight),
  );
  scrollByDeltaY(direction * lineHeight);
}

function scrollByPageStep(direction: -1 | 1) {
  const e = editor.value;
  if (!e) return;
  const lineHeight = Math.max(
    1,
    e.getOption(monaco.editor.EditorOption.lineHeight),
  );
  const viewportHeight = Math.max(1, e.getLayoutInfo().height);
  // 预留两行，避免翻屏后阅读点跳得过猛。
  const step = Math.max(lineHeight, viewportHeight - lineHeight * 2);
  scrollByDeltaY(direction * step);
}

function scrollToBottom(smooth = false) {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  e.setScrollTop(maxTop, monacoScrollType(smooth));
}

/**
 * 嵌入图片 View Zone 会改变 scrollHeight；须在 Zone 与正文都进布局后再钳制滚动。
 * - 贴近物理顶：scrollTop≤edge 或「篇首插图」时 jumpToLine(1) 会得到 scrollTop≈getTopForLineNumber(1)（>0），须归一为 0。
 * - 贴近物理底：scrollTop≈maxTop。
 * 双帧：首帧 + rAF 再跑一遍，避免 Zone 插入后首帧 scrollHeight 仍未稳定。
 */
function normalizeScrollAfterEmbeddedViewZones() {
  const runPass = () => {
    const e = editor.value;
    if (!e) return;
    beginProgrammaticScroll();
    e.layout();
    e.render(true);
    const layoutH = Math.max(1, e.getLayoutInfo().height);
    const maxTop = Math.max(0, e.getScrollHeight() - layoutH);
    const lh = Math.max(1, e.getOption(monaco.editor.EditorOption.lineHeight));
    const edgePx = Math.min(8, lh * 0.35);
    const alignTol = Math.max(edgePx, Math.floor(lh * 0.45));
    const st0 = Math.max(0, e.getScrollTop());
    const top1 = e.getTopForLineNumber(1);

    if (st0 <= edgePx) {
      e.setScrollTop(0, monaco.editor.ScrollType.Immediate);
    } else if (top1 > 0 && st0 >= top1 - alignTol && st0 <= top1 + alignTol) {
      // 与 jumpToLine(1) 顶对齐同一语义：正文第 1 行顶在视口顶；篇首若有 Zone 在上方，物理「篇首」应为 scrollTop=0。
      e.setScrollTop(0, monaco.editor.ScrollType.Immediate);
    } else if (maxTop > 0 && st0 >= maxTop - edgePx) {
      e.setScrollTop(maxTop, monaco.editor.ScrollType.Immediate);
    }
  };
  runPass();
  requestAnimationFrame(runPass);
}

function getScrollTop(): number {
  const e = editor.value;
  if (!e) return 0;
  return Math.max(0, e.getScrollTop());
}

/** 滚动到指定 scrollTop（可选平滑）；会钳制到当前可滚动范围 */
function scrollToScrollTop(scrollTop: number, smooth = true) {
  const e = editor.value;
  if (!e) return;
  beginProgrammaticScroll();
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const target = Math.max(0, Math.min(maxTop, scrollTop));
  e.setScrollTop(target, monacoScrollType(smooth));
  e.focus();
}

/**
 * 将指定行尽量贴到底部（近似 revealLineNearBottom）。
 * 通过行底像素 - 视口高度计算 scrollTop，避免“先按顶部跳转再减跨度”带来的累计漂移。
 */
function scrollLineToBottom(lineNumber: number, smooth = false) {
  const e = editor.value;
  const m = model.value;
  if (!e || !m) return;
  beginProgrammaticScroll();
  const lineCount = Math.max(1, m.getLineCount());
  const line = Math.max(1, Math.min(Math.floor(lineNumber), lineCount));
  const layoutH = Math.max(1, e.getLayoutInfo().height);
  const lineBottomPx =
    line >= lineCount ? e.getScrollHeight() : e.getTopForLineNumber(line + 1);
  const maxTop = Math.max(0, e.getScrollHeight() - layoutH);
  const targetTop = Math.max(0, Math.min(maxTop, lineBottomPx - layoutH));
  e.setScrollTop(targetTop, monacoScrollType(smooth));
  e.setPosition({ lineNumber: line, column: 1 });
}

/** 供 `colorTxt.file.meta` 持久化；深拷贝为可 JSON 序列化的纯对象 */
function getSerializedEditorViewState(): Record<string, unknown> | null {
  const e = editor.value;
  if (!e) return null;
  const vs = e.saveViewState();
  if (!vs) return null;
  try {
    return JSON.parse(JSON.stringify(vs)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function restoreEditorViewState(state: unknown): boolean {
  const e = editor.value;
  if (!e || state == null || typeof state !== "object") return false;
  beginProgrammaticScroll();
  try {
    e.restoreViewState(state as monaco.editor.ICodeEditorViewState);
    return true;
  } catch {
    return false;
  }
}

/** 与 `emitProbeLine` 相同的阅读探针行号（视口内约 3/4 处），1-based */
function getProbeLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  const fallbackLine = e.getPosition()?.lineNumber ?? 1;
  if (!r) return fallbackLine;
  const span = Math.max(0, r.endLineNumber - r.startLineNumber);
  return r.startLineNumber + Math.floor(span * 0.75);
}

/** 与 `emitProbeLine` 内 `endLine` 一致：当前视口末行（Monaco 显示行号） */
function getViewportEndLine(): number {
  const e = editor.value;
  if (!e) return 1;
  const r = e.getVisibleRanges()[0];
  const fallbackLine = e.getPosition()?.lineNumber ?? 1;
  if (!r) return fallbackLine;
  return Math.max(1, r.endLineNumber);
}

function readerEditCursorPayload(
  ed: monaco.editor.ICodeEditor,
): { line: number; column: number; selectionLength: number } | null {
  const m = ed.getModel();
  const pos = ed.getPosition();
  if (!m || !pos) return null;
  const sel = ed.getSelection();
  let selectionLength = 0;
  if (sel && !sel.isEmpty()) {
    selectionLength = m.getValueLengthInRange(sel);
  }
  return {
    line: pos.lineNumber,
    column: pos.column,
    selectionLength,
  };
}

/** 底栏行列号：Diff 预览时跟随当前聚焦的左/右编辑器，否则为主编辑器 */
function emitReaderEditCursorStatus(fromEditor?: monaco.editor.ICodeEditor) {
  if (!props.readerEditMode) return;
  let ed = fromEditor;
  if (!ed) {
    if (smartFormatReviewActive.value) {
      const diff = smartFormatDiffEditor.value;
      if (!diff) return;
      const modified = diff.getModifiedEditor();
      const original = diff.getOriginalEditor();
      if (modified.hasTextFocus()) ed = modified;
      else if (original.hasTextFocus()) ed = original;
      else return;
    } else {
      ed = editor.value ?? undefined;
    }
  }
  if (!ed) return;
  const payload = readerEditCursorPayload(ed);
  if (!payload) return;
  emit("readerEditCursorChange", payload);
}

function emitProbeLine(fromScroll = false) {
  const e = editor.value;
  if (!e) return;
  const fromReadingScroll = fromScroll && programmaticScrollDepth === 0;
  const probeLine = getProbeLine();
  const r = e.getVisibleRanges()[0];
  const startLine = r ? Math.max(1, r.startLineNumber) : 1;
  const endLine = r ? Math.max(1, r.endLineNumber) : probeLine;
  const maxTop = Math.max(0, e.getScrollHeight() - e.getLayoutInfo().height);
  const scrollTop = Math.max(0, e.getScrollTop());
  const atBottom = maxTop <= 0 ? true : scrollTop >= maxTop - 1;
  const percent =
    maxTop <= 0 ? 100 : floorReadingPercentFromScrollRatio(scrollTop / maxTop);
  emit("probeLineChange", probeLine, fromReadingScroll);
  emit("viewportTopLineChange", startLine);
  emit("viewportEndLineChange", endLine);
  emit("viewportVisualProgressChange", percent, atBottom);
}

/** 统计高亮词匹配数 */
function countHighlightTermMatches(
  terms: import("../utils/highlightWords").HighlightListTerm[],
  m?: monaco.editor.ITextModel | null,
) {
  const modelToUse = m ?? model.value;
  if (!modelToUse) return terms.map((t) => ({ ...t, matchCount: 0 }));
  return terms.map((t) => {
    const q = t.text.trim();
    if (!q) return { ...t, matchCount: 0 };
    const matches = modelToUse.findMatches(q, false, false, false, null, false);
    return { ...t, matchCount: matches?.length ?? 0 };
  });
}

defineExpose({
  appendText,
  setFullText,
  flushStreamCarriageReturn,
  normalizeLastLineLeadIndent,
  clear,
  setChapters,
  setTheme,
  setFontSize,
  setLineHeightMultiple,
  setFontFamily,
  setWrappingStrategyAdvanced,
  resetToTop,
  scrollToDocumentStart,
  jumpToLine,
  scrollToLineNearTop,
  jumpToLineCentered,
  scrollModelLineBlockToViewportCenter,
  getModelLineAtViewportCenter,
  getViewportStartModelLine,
  setVoiceReadLineHighlight,
  getVoiceReadHighlightedLine: () => voiceReadHighlightLine.value,
  jumpToSearchMatchCentered: inlineSearch.jumpToSearchMatchCentered,
  jumpToNextInlineSearchMatch: inlineSearch.jumpToNextInlineSearchMatch,
  hasInlineSearchQuery: inlineSearch.hasInlineSearchQuery,
  jumpToBookmarkLine,
  getBookmarkSaveAnchorDisplayLine,
  captureViewportRestoreAnchor,
  restoreViewportToRestoreAnchor,
  setInlineSearchState: inlineSearch.setInlineSearchState,
  clearInlineSearchState: inlineSearch.clearInlineSearchState,
  emitProbeLine,
  getProbeLine,
  getViewportEndLine,
  getViewportTopLine,
  getViewportLineSpan,
  getAllText,
  applyEditFormatCompressBlankLines,
  applyEditFormatCompressBlankLinesInRange,
  applyEditFormatLeadIndentFullWidth,
  applyEditFormatTextConvertZh,
  applyEditFormatTextConvertLetters,
  applyEditFormatTextConvertDigits,
  applyEditFormatLeadIndentFullWidthInRange,
  applySmartFormatReviewCompressBlankLines,
  applySmartFormatReviewLeadIndentFullWidth,
  markReaderEditSaved,
  sealReaderEditBaseline,
  getEditorLineContent,
  getModelLineCount,
  getSelectedText,
  getSelectionRange,
  applyEditLineRangePatch,
  getSmartFormatPostProcessContext: smartFormatPostProcessContext,
  getSmartFormatReviewModifiedText,
  focusSmartFormatAppliedRange,
  revealSmartFormatSegment,
  setSmartFormatRunning,
  toggleFindWidget,
  closeFindWidgetIfRevealed,
  openFindWithSearchString,
  isFindWidgetRevealed,
  focusEditor,
  scrollByDeltaY,
  delegateEditorWheelFromBrowserEvent,
  scrollByLineStep,
  scrollByPageStep,
  scrollToBottom,
  normalizeScrollAfterEmbeddedViewZones,
  scrollLineToBottom,
  getScrollTop,
  scrollToScrollTop,
  getSerializedEditorViewState,
  restoreEditorViewState,
  applyEmbeddedImageAnchors,
  applyMarkdownInternalLinks,
  setPendingEbookInternalLinkSidecar,
  shiftPendingEbookSidecarForDeletedDisplayLines,
  getEbookLeadingLinkLabelsByDisplayLine,
  getReaderEditorDomNode: () => editor.value?.getDomNode() ?? null,
  // Highlight-term utilities
  countHighlightTermMatches,
  // Annotation utilities
  jumpToAnnotationRange,
  getAnnotationDisplayQuote,
  getAnnotationHitsByLine,
  refreshReaderAnnotationDecorations: refreshAnnotationDecorations,
  suppressHighlightTipForProgrammaticSelection,
  // Editor model access
  getModel: () => model.value ?? null,
});

function applyReaderSyntaxFromProps() {
  setReaderSyntaxHighlightEnabled(
    monaco,
    props.monacoCustomHighlight,
    props.readerSurfaceLight,
    props.readerSurfaceDark,
    props.highlightColors,
  );
  setTheme(lastAppThemeName);
}

const LINEATION_COLOR_STYLE_ID = "txtr-reader-lineation-colors";

function syncLineationColorStyles() {
  let styleEl = document.getElementById(
    LINEATION_COLOR_STYLE_ID,
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = LINEATION_COLOR_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = annotationMarkerCssRules(props.lineationColors);
}

watch(
  () =>
    [props.monacoCustomHighlight, props.txtrDelimitedMatchCrossLine] as const,
  () => {
    applyReaderSyntaxFromProps();
    applyTxtrMonarchTokenizer();
    if (!props.monacoCustomHighlight) {
      closeHighlightFloatUi();
    }
  },
);

watch(
  () => [props.readerSurfaceLight, props.readerSurfaceDark] as const,
  () => {
    applyReaderSyntaxFromProps();
  },
  { deep: true },
);

onMounted(() => {
  // Register language + providers once (across HMR)。
  const g = globalThis as any;
  if (!g[globalKey]) {
    monaco.languages.register({ id: languageId });

    const chapterSticky = registerChapterStickyScrollProviders(
      monaco,
      languageId,
      () => chaptersSnapshot,
    );
    providersDisposables.push(chapterSticky.disposable);
    notifyChapterStickyFoldingRanges =
      chapterSticky.notifyChapterFoldingRangesChanged;

    g[globalKey] = true;
  }

  applyTxtrMonarchTokenizer();
  applyReaderSyntaxFromProps();
  syncLineationColorStyles();

  const fontStyleId = "txtr-reader-kinghwa-font";
  if (!document.getElementById(fontStyleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = fontStyleId;
    styleEl.textContent = `
@font-face {
  font-family: "KingHwa OldSong";
  src: url("${kingHwaFontUrl}") format("truetype");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;
    document.head.appendChild(styleEl);
  }

  const m = monaco.editor.createModel("", languageId);
  model.value = m;

  ensureStickyChapterBarClickDisabled();

  editor.value = monaco.editor.create(editorEl.value!, {
    model: m,
    /** 脚注悬停/补全等溢出挂件挂到专用容器，脱离 `.editorHost { overflow:hidden }` */
    overflowWidgetsDomNode: ensureReaderMonacoOverflowHost(),
    ...buildReaderEditorCreateOptions({
      fontSize: READER_EDITOR_DEFAULT_FONT_SIZE,
      lineHeightMultiple,
      fontFamily: currentFontFamily,
      wrappingStrategyAdvanced: props.monacoAdvancedWrapping,
      smoothScrolling: props.monacoSmoothScrolling,
    }),
  });
  chapterTitleDecorationsCollection.value =
    editor.value.createDecorationsCollection();
  inlineSearchDecorationsCollection.value =
    editor.value.createDecorationsCollection();
  annotationDecorationsCollection.value =
    editor.value.createDecorationsCollection();
  voiceReadDecorationsCollection.value =
    editor.value.createDecorationsCollection();
  minimapCursorLineDecorationsCollection.value =
    editor.value.createDecorationsCollection();
  chapterMinimapDecorationsCollection.value =
    editor.value.createDecorationsCollection();

  bindAnnotationScrollSync(editor.value);
  rebuildAnnotationIndex();

  const e = editor.value;
  if (e) {
    if (currentFontFamily.includes("KingHwa OldSong")) {
      void document.fonts
        ?.load(`${READER_EDITOR_DEFAULT_FONT_SIZE}px "KingHwa OldSong"`)
        .then(() => {
          e.updateOptions({ fontFamily: currentFontFamily });
        });
    }
    const d1 = e.onDidScrollChange(() => {
      emitProbeLine(true);
    });
    const d2 = e.onDidChangeCursorPosition(() => {
      emitProbeLine(false);
      syncMinimapCursorLineDecoration();
      if (!smartFormatReviewActive.value) emitReaderEditCursorStatus();
    });
    const dSel = e.onDidChangeCursorSelection(() => {
      if (!smartFormatReviewActive.value) emitReaderEditCursorStatus();
      if (readerAnn.shouldSuppressToolbar()) {
        closeHighlightFloatUi();
        return;
      }
      onSelectionChangedDuringInteraction();
      if (inlineSearch.hasInlineSearchQuery()) {
        inlineSearch.applyInlineSearchDecorations();
      }
      syncMinimapCursorLineDecoration();
    });
    const d3 = installReaderScrollKeyHandler(monaco, e, {
      onSpacePageDown: () => {
        if (props.voiceReadScrollLocked) return;
        scrollByPageStep(1);
      },
      shouldInterceptReadOnlyKeys: () =>
        !props.readerEditMode && !props.voiceReadScrollLocked,
    });
    const d4 = e.onContextMenu((mouseEv) => {
      const m = model.value;
      if (!m) return;
      if (smartFormatReviewActive.value) {
        mouseEv.event.preventDefault();
        mouseEv.event.stopPropagation();
        return;
      }
      if (props.readerEditMode) {
        if (smartFormatRunning.value) {
          mouseEv.event.preventDefault();
          mouseEv.event.stopPropagation();
          return;
        }
        mouseEv.event.preventDefault();
        mouseEv.event.stopPropagation();
        const sel = e.getSelection();
        editorEditContextMenuHasSelection.value = Boolean(
          sel && !sel.isEmpty(),
        );
        editorEditContextMenuX.value = mouseEv.event.browserEvent.clientX;
        editorEditContextMenuY.value = mouseEv.event.browserEvent.clientY;
        editorEditContextMenuOpen.value = true;
        return;
      }
    });
    saveCommandDisposable = e.addAction({
      id: "colortxt.readerEdit.save",
      label: "保存",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run() {
        if (props.readerEditMode) emit("readerEditSaveRequest");
      },
    });
    /**
     * Monaco 内部命中测试在部分 DOM 路径下会先得到 UNKNOWN 并短路；`.view-lines` 在 `.view-zones` 之后插入会盖住 zone。
     * CSS 抬高 `.view-zones`；在 `editorHost` 上 **捕获** pointerdown：先处理电子书内链（须早于 Monaco 默认 mousedown），再处理插图灯箱。
     */
    const editorHost = editorEl.value;
    const onReaderPointerDownCapture = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      if (
        ebookInternalLinkHitCount.value > 0 &&
        tryJumpEbookInternalLinkFromPoint(ev.clientX, ev.clientY)
      ) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return;
      }
      readerAnn.beginSelectionPointerInteraction();
      if (imageViewZoneIds.value.length === 0) return;
      const t = ev.target;
      if (!(t instanceof Element)) return;
      const zone = t.closest(".readerImageViewZone");
      if (!zone || !(zone instanceof HTMLElement)) return;
      if (!editorHost?.contains(zone)) return;
      const url = zone.dataset.colortxtImgUrl?.trim();
      if (!url) return;
      const img = zone.querySelector("img");
      if (!(img instanceof HTMLImageElement)) return;
      const r = img.getBoundingClientRect();
      const { clientX, clientY } = ev;
      if (
        clientX < r.left ||
        clientX > r.right ||
        clientY < r.top ||
        clientY > r.bottom
      ) {
        return;
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      imageLightboxSrc.value = url;
      readerAnn.cancelSelectionPointerInteraction();
    };
    editorHost?.addEventListener(
      "pointerdown",
      onReaderPointerDownCapture,
      true,
    );
    onBeforeUnmount(() => {
      d1.dispose();
      d2.dispose();
      dSel.dispose();
      d3.dispose();
      d4.dispose();
      saveCommandDisposable?.dispose();
      saveCommandDisposable = null;
      editorHost?.removeEventListener(
        "pointerdown",
        onReaderPointerDownCapture,
        true,
      );
      readerAnn.cancelSelectionPointerInteraction();
    });

    applyReaderMonacoModeOptions(Boolean(props.readerEditMode));
    syncStickyScrollToStreamState();
    syncMinimapCursorLineDecoration();
    syncChapterMinimapSectionHeaderDecorations();
  }
});

onBeforeUnmount(() => {
  if (stickyChapterScrollRefreshRaf != null) {
    cancelAnimationFrame(stickyChapterScrollRefreshRaf);
    stickyChapterScrollRefreshRaf = null;
  }
  notifyChapterStickyFoldingRanges = null;
  disposeEbookInternalLinks();
  cancelImageViewZoneScrollRender();
  removeHlGlobalListeners?.();
  removeHlGlobalListeners = null;
  unsubModalStack?.();
  unsubModalStack = null;
  removeVoiceReadKeyCapture?.();
  removeVoiceReadKeyCapture = null;
  removeSmartFormatReviewKeyCapture?.();
  removeSmartFormatReviewKeyCapture = null;
  disposeAnnotationDecorations();
  editor.value?.dispose();
  model.value?.dispose();
  disposeReaderMonacoOverflowHost();
  for (const d of providersDisposables) d.dispose();
  providersDisposables = [];
});

watch(
  () => [props.readerEditMode, props.physicalReaderPath] as const,
  async ([edit, physRaw]) => {
    const phys = physRaw?.trim() ?? "";
    if (!edit) {
      teardownReaderEditContentListener();
      readerEditLoadedPhysicalKey = "";
      applyReaderMonacoModeOptions(false);
      return;
    }
    if (!phys) return;
    if (readerEditLoadedPhysicalKey !== phys) {
      await loadReaderEditFromDisk();
      return;
    }
    applyReaderMonacoModeOptions(true);
    teardownReaderEditContentListener();
    const m = model.value;
    if (m) {
      readerEditContentDisposable = m.onDidChangeContent(() => {
        onReaderEditModelContentChange();
      });
      sealReaderEditBaseline();
    }
  },
  { flush: "post" },
);

watch(
  () => props.readerFilePath,
  () => {
    closeHighlightFloatUi();
  },
);

watch(
  () => props.voiceReadScrollLocked,
  (locked) => {
    removeVoiceReadKeyCapture?.();
    removeVoiceReadKeyCapture = null;
    if (!locked) return;
    const onKey = (ev: KeyboardEvent) => {
      const root = editor.value?.getDomNode();
      if (!root) return;
      const t = ev.target;
      if (!(t instanceof Node) || !root.contains(t)) return;
      const k = ev.key;
      if (
        k === "ArrowUp" ||
        k === "ArrowDown" ||
        k === "PageUp" ||
        k === "PageDown" ||
        k === " " ||
        k === "Home" ||
        k === "End"
      ) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    removeVoiceReadKeyCapture = () =>
      document.removeEventListener("keydown", onKey, true);
  },
);

onMounted(() => {
  unsubModalStack = subscribeModalStackChange(() => {
    if (!toolbarVisible.value && !colorPickerMode.value) return;
    if (readerAnn.shouldSuppressToolbar()) return;
    if (hasModalOnStack() || hasEscBeforeModalLayers()) {
      closeHighlightFloatUi();
    }
  });
});

watch(smartFormatReviewActive, (active) => {
  removeSmartFormatReviewKeyCapture?.();
  removeSmartFormatReviewKeyCapture = null;
  if (!active) {
    closeDiffReviewContextMenu();
    requestAnimationFrame(() => editor.value?.layout());
    void nextTick(() => emitReaderEditCursorStatus());
    return;
  }
  const onKey = (ev: KeyboardEvent) => {
    if (!ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
    if (smartFormatDiffChangeCount.value === 0) return;
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      ev.stopPropagation();
      smartFormatDiffGoToPrevious();
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      ev.stopPropagation();
      smartFormatDiffGoToNext();
    }
  };
  document.addEventListener("keydown", onKey, true);
  removeSmartFormatReviewKeyCapture = () =>
    document.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <main
    class="content"
    :class="{
      'content--readerEdit': readerEditMode,
      'content--readerEditMinimap': readerEditMode && readerEditMinimap,
    }"
  >
    <div
      class="editorShell"
      :class="{ 'editorShell--smartFormatReview': smartFormatReviewActive }"
    >
      <div v-if="smartFormatReviewActive" class="smartFormatReviewBar">
        <div class="smartFormatReviewBarMain">
          <span class="smartFormatReviewBarTitle">排版预览</span>
          <span class="smartFormatReviewBarMeta">{{
            smartFormatReviewScopeLabel
          }}</span>
        </div>
        <div class="smartFormatReviewBarActions">
          <div class="smartFormatReviewBarTools">
            <span
              v-if="smartFormatDiffChangeCount > 0"
              class="smartFormatReviewBarChanges"
            >
              {{ smartFormatDiffChangeCount }} 处差异
            </span>
            <IconButton
              :icon-html="icons.upThin"
              title="上一个更改 (Ctrl+↑)"
              aria-label="上一个更改"
              :disabled="smartFormatDiffChangeCount === 0"
              @click="smartFormatDiffGoToPrevious"
            />
            <IconButton
              :icon-html="icons.downThin"
              title="下一个更改 (Ctrl+↓)"
              aria-label="下一个更改"
              :disabled="smartFormatDiffChangeCount === 0"
              @click="smartFormatDiffGoToNext"
            />
            <IconButton
              :icon-html="icons.paragraph"
              title="显示行首/行尾空白差异"
              aria-label="显示行首/行尾空白差异"
              :active="smartFormatDiffShowWhitespace"
              :pressed="smartFormatDiffShowWhitespace"
              @click="smartFormatDiffToggleWhitespace"
            />
            <IconButton
              :icon-html="icons.foldUnchanged"
              title="折叠未更改区域"
              aria-label="折叠未更改区域"
              :active="smartFormatDiffHideUnchanged"
              :pressed="smartFormatDiffHideUnchanged"
              @click="smartFormatDiffToggleHideUnchanged"
            />
          </div>
          <span class="smartFormatReviewBarDivider" aria-hidden="true" />
          <button
            type="button"
            class="btn warning"
            @click="onSmartFormatReviewDiscard"
          >
            放弃
          </button>
          <button
            type="button"
            class="btn primary"
            @click="onSmartFormatReviewApply"
          >
            应用
          </button>
        </div>
      </div>
      <div
        ref="editorEl"
        class="editorHost"
        :class="{ 'editorHost--hidden': smartFormatReviewActive }"
      ></div>
      <div
        ref="diffHostEl"
        class="editorHost editorHost--diff"
        :class="{ 'editorHost--hidden': !smartFormatReviewActive }"
      ></div>
      <div
        v-if="voiceReadScrollLocked"
        class="voiceReadScrollBlocker"
        aria-hidden="true"
        @wheel.prevent.stop
      />
      <VoiceReadResumeGuide
        :visible="voiceReadPaused === true"
        @resume="emit('voiceReadResume')"
      />
      <div ref="notePanelRootRef" class="notePanelHost">
        <ReaderNoteInputPanel
          :open="notePanelOpen"
          :draft="notePanelDraft"
          :source-text="notePanelSourceText"
          :editing="notePanelEditing"
          :monaco-font-family="monacoFontFamily"
          @confirm="onNotePanelConfirm"
          @close="closeNotePanel"
          @delete-note="onNotePanelDelete"
        />
      </div>
    </div>
    <div
      v-if="toolbarVisible || colorPickerMode"
      ref="floatRootRef"
      class="hlFloatRoot"
      :style="{ zIndex: HL_FLOAT_Z_INDEX }"
      aria-live="polite"
    >
      <ReaderSelectionToolbar
        :toolbar-visible="toolbarVisible"
        :color-picker-mode="colorPickerMode"
        :lineation-picker-type="lineationPickerType"
        :float-center-x="floatCenterX"
        :float-root-top="floatRootTop"
        :open-downward="floatOpenDownward"
        :highlight-colors="highlightColors"
        :lineation-colors="lineationColors"
        :show-highlight-remove-row="hlPickerShowRemoveRow"
        :existing-highlight-color-index="hlPickerExistingColorIndex"
        :active-lineation="activeLineation"
        :lineation-picker-selected-index="lineationPickerSelectedIndex"
        :monaco-custom-highlight="monacoCustomHighlight"
        :ai-features-enabled="aiFeaturesEnabled"
        :has-lineation="toolbarHasLineation"
        :has-note="toolbarHasNote"
        @action="onToolbarAction"
        @highlight-pick-confirm="onHighlightPickConfirm"
        @highlight-pick-remove="onHighlightPickRemove"
        @lineation-pick-confirm="onLineationPickConfirm"
      />
    </div>
    <AppContextMenu
      :open="editorEditContextMenuOpen"
      :x="editorEditContextMenuX"
      :y="editorEditContextMenuY"
      :items="editorEditContextMenuItems"
      :min-width="200"
      @close="closeEditorEditContextMenu"
      @select="onEditorEditContextMenuSelect"
    />
    <AppContextMenu
      :open="diffReviewContextMenuOpen"
      :x="diffReviewContextMenuX"
      :y="diffReviewContextMenuY"
      :items="diffReviewContextMenuItems"
      :min-width="200"
      @close="closeDiffReviewContextMenu"
      @select="onDiffReviewContextMenuSelect"
    />
    <ReaderImageLightbox v-model="imageLightboxSrc" />
  </main>
</template>

<style scoped>
.content {
  height: 100%;
  background: var(--reader-bg);
  overflow: hidden;
  min-height: 0;
  user-select: text;
}

.editorShell {
  position: relative;
  height: 100%;
  width: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editorShell--smartFormatReview .editorHost--diff {
  flex: 1;
  min-height: 0;
}

.smartFormatReviewBar {
  --sf-review-control-h: 28px;
  container-type: inline-size;
  container-name: smart-format-review-bar;
  box-sizing: border-box;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
  height: calc(var(--sf-review-control-h) + 16px);
  overflow: hidden;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg, var(--reader-bg));
}

.smartFormatReviewBarMain {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
}

.smartFormatReviewBarTitle {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.smartFormatReviewBarMeta {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}

.smartFormatReviewBarChanges {
  font-size: 12px;
  color: var(--muted);
  margin-right: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.smartFormatReviewBarActions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.smartFormatReviewBarActions .btn {
  box-sizing: border-box;
  height: var(--sf-review-control-h);
  padding-block: 0;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.smartFormatReviewBarTools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  height: var(--sf-review-control-h);
}

.smartFormatReviewBarTools :deep(.iconBtn) {
  width: var(--sf-review-control-h);
  height: var(--sf-review-control-h);
}

.smartFormatReviewBarDivider {
  width: 1px;
  height: calc(var(--sf-review-control-h) - 6px);
  margin: 0 4px;
  background: var(--border);
  flex-shrink: 0;
}

/* 渐窄：先藏范围标签，再藏差异计数/工具按钮，保底标题 + 放弃/应用 */
@container smart-format-review-bar (max-width: 620px) {
  .smartFormatReviewBarMeta {
    display: none;
  }
}

@container smart-format-review-bar (max-width: 460px) {
  .smartFormatReviewBarTools,
  .smartFormatReviewBarDivider {
    display: none;
  }
}

.editorHost--hidden {
  display: none !important;
}

.editorHost--diff :deep(.monaco-diff-editor),
.editorHost--diff :deep(.monaco-editor) {
  height: 100%;
}

.voiceReadScrollBlocker {
  position: absolute;
  inset: 0;
  z-index: 50;
  cursor: default;
}

.editorHost {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow: hidden;
  user-select: text;
}

.hlFloatRoot {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

:deep(.monaco-editor),
:deep(.monaco-editor *) {
  user-select: text;
}

/* 仅只读：隐藏文本光标（与 cursorWidth:0 配合）；编辑模式交给 Monaco 默认绘制 */
.content:not(.content--readerEdit) :deep(.monaco-editor .cursor) {
  display: none !important;
}

/* 仅只读：弱化单词高亮装饰，避免「当前行」类视觉干扰阅读 */
.content:not(.content--readerEdit) :deep(.monaco-editor .wordHighlight),
.content:not(.content--readerEdit) :deep(.monaco-editor .wordHighlightStrong) {
  background: transparent !important;
}

/* 仅只读：打开自定义右键菜单时编辑器会失去 .focused，统一为活动选区背景 */
.content:not(.content--readerEdit) :deep(.monaco-editor .selected-text) {
  background-color: var(--vscode-editor-selectionBackground) !important;
}

/* 仅只读：去掉顶缘滚动阴影 */
.content:not(.content--readerEdit) :deep(.monaco-editor .scroll-decoration) {
  box-shadow: none !important;
  display: none !important;
}

/* 与 chapterStickyScroll.CHAPTER_TITLE_LINE_CLASS（chapterTitleLine）一致 */
:deep(.monaco-editor .chapterTitleLine) {
  color: var(--reader-chapter-title) !important;
  /* 勿用 transform:scale 配合大字号：缩放不占布局宽，行尾脚注图标会被挤到右侧 */
  font-size: 1.2em !important;
}
:deep(.monaco-editor .chapterTitleLine.readerEbookLinkIcon),
:deep(.monaco-editor .readerEbookLinkIcon.chapterTitleLine) {
  color: transparent !important;
  font-size: 1em !important;
}
/* 章节标题行内文字链接：须压过上行 .chapterTitleLine 的 color !important */
:deep(.monaco-editor .chapterTitleLine.readerEbookInternalLink),
:deep(.monaco-editor .readerEbookInternalLink.chapterTitleLine),
:deep(.monaco-editor .chapterTitleLine.readerEbookExternalLink),
:deep(.monaco-editor .readerEbookExternalLink.chapterTitleLine) {
  color: var(--reader-ebook-link-color) !important;
}
:deep(.monaco-editor .chapterTitleLine.readerEbookInternalLink:hover),
:deep(.monaco-editor .readerEbookInternalLink.chapterTitleLine:hover),
:deep(.monaco-editor .chapterTitleLine.readerEbookExternalLink:hover),
:deep(.monaco-editor .readerEbookExternalLink.chapterTitleLine:hover) {
  color: var(--reader-ebook-link-color) !important;
}
</style>
