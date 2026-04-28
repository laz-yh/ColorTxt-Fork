<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, useTemplateRef, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { getChapterMatchRules, type Chapter } from "./chapter";
import AppHeader, { type RecentFileItem } from "./components/AppHeader.vue";
import ReaderSidebar from "./components/ReaderSidebar.vue";
import AppFooter from "./components/AppFooter.vue";
import ReaderMain from "./components/ReaderMain.vue";
import AppAlertHost from "./components/AppAlertHost.vue";
import AppOverlays from "./components/AppOverlays.vue";
import type { SettingsApplyPayload } from "./components/SettingsPanel.vue";
import { bookmarkNoteInputRefKey } from "./injectionKeys";
import { useAppBookmarkPins } from "./composables/useAppBookmarkPins";
import { useAppChapterListSync } from "./composables/useAppChapterListSync";
import { useAppChapterNavigation } from "./composables/useAppChapterNavigation";
import { useAppFileSession } from "./composables/useAppFileSession";
import { useAppFullscreenReaderLayout } from "./composables/useAppFullscreenReaderLayout";
import { useAppPersistence } from "./composables/useAppPersistence";
import { useAppReaderChrome } from "./composables/useAppReaderChrome";
import { useAppReadingProgress } from "./composables/useAppReadingProgress";
import { useAppReaderUiPrefs } from "./composables/useAppReaderUiPrefs";
import { useAppShellThemeWatch } from "./composables/useAppShellThemeWatch";
import { useAppSyncCurrentFileWatch } from "./composables/useAppSyncCurrentFileWatch";
import { useAppWindowBindings } from "./composables/useAppWindowBindings";
import { useTxtStreamPipeline } from "./composables/useTxtStreamPipeline";
import { fileHistoryKey } from "./stores/recentHistoryStore";
import {
  assignHighlightTermToColorForFile,
  fileNameKey,
  findFileMetaRecord,
  removeHighlightTermFromFile,
  upsertFileMetaRecord,
  type FileMetaRecord,
} from "./stores/fileMetaStore";
import {
  applyReaderSurfaceToDocument,
  defaultCompressBlankKeepOneBlank,
  defaultCompressBlankLines,
  defaultChapterMinCharCount,
  defaultFullscreenReaderWidthPercent,
  defaultLeadIndentFullWidth,
  defaultMonacoAdvancedWrapping,
  defaultMonacoCustomHighlight,
  defaultMonacoSmoothScrolling,
  defaultReaderIdleHint,
  defaultReaderOpenHint,
  defaultReaderFontSize,
  defaultReaderLineHeightMultiple,
  defaultReaderPaletteDark,
  defaultReaderPaletteLight,
  defaultReaderTheme,
  defaultRecentFilesHistoryLimit,
  mergeReaderSurfacePalette,
  overridesFromFullPalette,
  defaultRestoreSessionOnStartup,
  defaultSyncCurrentFile,
  defaultTxtrDelimitedMatchCrossLine,
  defaultShowChapterCounts,
  defaultShowSidebar,
  emptyFileHintText,
  readerTxtLoadingHintText,
  GITHUB_REPO_URL,
  maxFullscreenReaderWidthPercent,
  clampLineHeightMultipleForFontSize,
  maxFontSize,
  maxChapterMinCharCount,
  maxLineHeightMultipleForFontSize,
  maxRecentFilesHistoryLimit,
  minFullscreenReaderWidthPercent,
  minFontSize,
  minChapterMinCharCount,
  minLineHeightMultiple,
  SIDEBAR_ACTIVITY_BAR_WIDTH,
  type ReaderSurfacePalette,
} from "./constants/appUi";
import {
  DEFAULT_HIGHLIGHT_COLORS_DARK,
  DEFAULT_HIGHLIGHT_COLORS_LIGHT,
  MIN_HIGHLIGHT_COLORS,
  mergeHighlightColors,
} from "./constants/highlightColors";
import { formatCharCount, formatFileSize } from "./utils/format";
import { READER_EDITOR_DEFAULT_FONT_FAMILY } from "./monaco/readerEditorOptions";
import {
  createDefaultShortcutBindings,
  type ShortcutBindingMap,
} from "./services/shortcutRegistry";
import { appAlert } from "./services/appAlert";
import { mergeShortcutBindings } from "./services/shortcutUtils";
import {
  syncTxtFilesCategoriesAfterCatalogEdit,
  normalizeTxtFileItem,
  type TxtFileItem,
} from "./services/fileListService";
import {
  cloneDefaultFileCategoryCatalog,
  DEFAULT_FILE_SORT,
  FILE_CATEGORY_FILTER_ALL,
  FILE_CATEGORY_FILTER_UNCATEGORIZED,
  type CategoryEditorRow,
  type FileCategoryDefinition,
  type FileSortMode,
} from "./constants/fileCategories";

const readerRef = ref<InstanceType<typeof ReaderMain> | null>(null);
/** 全屏侧栏文件列表是否有 Teleport 弹层打开（分类/筛选下拉、右键菜单等） */
const fullscreenFileListPopoversOpen = ref(false);
/** 全屏下打开设置/配色弹框期间，禁用左缘感应自动唤起侧栏 */
const suppressFullscreenSidebarHover = ref(false);
const chrome = useAppReaderChrome({
  readerRef,
  fullscreenFileListPopoversOpen,
  suppressFullscreenSidebarHover,
});
const {
  isFullscreenView,
  showFullscreenTip,
  fullscreenTipFading,
  showFullscreenHeader,
  fullscreenHeaderOverlayRef,
  showFullscreenFooter,
  fullscreenFooterOverlayRef,
  showFullscreenSidebar,
  fullscreenSidebarOverlayRef,
  sidebarWidth,
  fullscreenSidebarWidth,
  sidebarWidthForLayout,
  resizingSidebar,
  enterOrExitFullscreenView,
  getSidebarMaxWidth,
  getSidebarMinWidth,
  clampSidebarWidthToViewport,
  startResizeSidebar,
  updateFullscreenHeaderHover,
  updateFullscreenFooterHover,
  updateFullscreenSidebarHover,
  onFullscreenSidebarMouseLeave,
  onFullscreenHeaderMouseLeave,
  onFullscreenFooterMouseLeave,
  dismissFullscreenPanelsOnLayoutPointerDown,
  endSidebarResize,
  dismissFullscreenChromeForNativeExit,
  fullscreenCursorHidden,
  bumpFullscreenCursorIdle,
  recordFullscreenPointer,
} = chrome;

function setFullscreenHeaderOverlayEl(
  el: Element | ComponentPublicInstance | null,
) {
  if (el == null) {
    fullscreenHeaderOverlayRef.value = null;
    return;
  }
  fullscreenHeaderOverlayRef.value =
    el instanceof HTMLElement
      ? el
      : ((el as ComponentPublicInstance).$el as HTMLElement | null);
}

function setFullscreenFooterOverlayEl(
  el: Element | ComponentPublicInstance | null,
) {
  if (el == null) {
    fullscreenFooterOverlayRef.value = null;
    return;
  }
  fullscreenFooterOverlayRef.value =
    el instanceof HTMLElement
      ? el
      : ((el as ComponentPublicInstance).$el as HTMLElement | null);
}

const showAboutPanel = ref(false);
const showShortcutPanel = ref(false);
const showSettingsPanel = ref(false);
const showColorSchemePanel = ref(false);
watch(
  () => [showSettingsPanel.value, showColorSchemePanel.value] as const,
  ([settingsOpen, colorOpen]) => {
    suppressFullscreenSidebarHover.value = settingsOpen || colorOpen;
  },
  { immediate: true },
);
const appOverlaysRef = ref<InstanceType<typeof AppOverlays> | null>(null);
const showChapterRulePanel = ref(false);
const chapterRuleErrorText = ref("");
const chapterRuleState = ref(getChapterMatchRules());
const currentFile = ref<string | null>(null);
const loading = ref(false);
/** 打开文件时主进程流式读取的字节进度（0–100），无总大小时为 null */
const loadingProgressPercent = ref<number | null>(null);
/** 递归扫描目录中的 .txt 时：蒙版 + 当前处理的相对路径 */
const dirListScanning = ref(false);
const dirListCurrentName = ref("");
/** 拖入阅读区时显示局部「打开文件」蒙层（由 useAppWindowBindings 驱动） */
const readerDropOverlayVisible = ref(false);
const fileEncoding = ref<string>("-");
const currentFileSize = ref<number | null>(null);
const totalCharCount = ref(0);
const totalLineCount = ref(0);

const chapters = ref<Chapter[]>([]);
const activeChapterIdx = ref<number>(-1);
const showChapterCounts = ref(defaultShowChapterCounts);
const sidebarTab = ref<
  "files" | "chapters" | "bookmarks" | "highlights" | "search"
>(
  "files",
);
type SidebarSearchResult = {
  physicalLine: number;
  displayLine: number;
  text: string;
  ranges: Array<{ start: number; end: number }>;
};
const searchQuery = ref("");
const searchResults = ref<SidebarSearchResult[]>([]);
const searchInProgress = ref(false);
const activeSearchResultPhysicalLine = ref<number | null>(null);
const searchMatchCase = ref(false);
const searchWholeWord = ref(false);
const searchUseRegex = ref(false);
const SEARCH_RESULT_LIMIT = 20000;
const SEARCH_DEBOUNCE_MS = 180;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let searchRunToken = 0;
const txtFiles = ref<TxtFileItem[]>([]);
const fileCategory = ref<string>(FILE_CATEGORY_FILTER_ALL);
const fileSort = ref<FileSortMode>(DEFAULT_FILE_SORT);
const fileCategoryCatalog = ref<FileCategoryDefinition[]>(
  cloneDefaultFileCategoryCatalog(),
);
const fileMetaRecords = ref<FileMetaRecord[]>([]);
const showSidebar = ref(defaultShowSidebar);
const readerSidebarRef = ref<InstanceType<typeof ReaderSidebar> | null>(null);
const chapterSync = useAppChapterListSync();
const {
  chapterListScrollSmooth,
  shouldCenterChapterList,
  pulseChapterListCenter,
  shouldCenterFileList,
  suppressFileListCenterAfterLoad,
  shouldCenterBookmarkList,
  pulseBookmarkListCenter,
} = chapterSync;
/** 阅读区无打开文件且未在加载/转换时，居中显示 defaultReaderIdleHint */
const showReaderIdleHint = computed(() => !currentFile.value && !loading.value);
/** 电子书正文流尚未写入行时，复用 `.readerIdleHint` 居中提示 */
const showReaderBusyHint = computed(
  () =>
    loading.value && totalLineCount.value === 0 && totalCharCount.value === 0,
);
const readerBusyHintText = computed(() => readerTxtLoadingHintText);
/** 已打开文件且流式加载完成、正文行数与字数均为 0 时居中提示 */
const showReaderEmptyHint = computed(
  () =>
    Boolean(currentFile.value) &&
    !loading.value &&
    totalCharCount.value === 0 &&
    totalLineCount.value === 0,
);
/** 非全屏：侧栏壳（含活动栏）始终占位；全屏：仅浮动展开时显示整块 */
const sidebarShellVisible = computed(
  () => !isFullscreenView.value || showFullscreenSidebar.value,
);
/** 非全屏且收起面板时仅活动栏宽度；其余与 `sidebarWidthForLayout` 一致 */
const sidebarPaneLayoutWidth = computed(() => {
  if (isFullscreenView.value) return sidebarWidthForLayout.value;
  if (!showSidebar.value) return SIDEBAR_ACTIVITY_BAR_WIDTH;
  return sidebarWidthForLayout.value;
});
const currentTheme = ref(defaultReaderTheme);
/** Monaco txtr.* 语法着色（标点/数字/英文/引号与括号内等） */
const monacoCustomHighlight = ref(defaultMonacoCustomHighlight);
/** 为 true 时在加载文件流中丢弃空行（仅空格/缩进也视为空行） */
const compressBlankLines = ref(defaultCompressBlankLines);
/** 压缩空行时是否在每行正文下方保留一行空行（章节标题行除外） */
const compressBlankKeepOneBlank = ref(defaultCompressBlankKeepOneBlank);
/** 与「内容上色」同时生效：Monarch 成对引号/括号是否跨行 */
const txtrDelimitedMatchCrossLine = ref(defaultTxtrDelimitedMatchCrossLine);
/** 为 true 时正文行统一行首两个全角空格（章节标题行与空行除外） */
const leadIndentFullWidth = ref(defaultLeadIndentFullWidth);
const readerFontSize = ref(defaultReaderFontSize);
const readerLineHeightMultiple = ref(defaultReaderLineHeightMultiple);
const monacoFontFamily = ref(READER_EDITOR_DEFAULT_FONT_FAMILY);
const defaultShortcutBindings = createDefaultShortcutBindings(
  /mac|iphone|ipad|ipod/i.test(navigator.platform || ""),
);
const shortcutBindings = ref<ShortcutBindingMap>({
  ...defaultShortcutBindings,
});

/** 启动时是否恢复上次会话快照（localStorage）；关闭时不写入会话 */
const restoreSessionOnStartup = ref(defaultRestoreSessionOnStartup);
/** 磁盘上当前正文变更后是否自动重新加载（设置项） */
const syncCurrentFile = ref(defaultSyncCurrentFile);
/** 最近打开文件条数上限，0 表示不记录 */
const recentFilesHistoryLimit = ref(defaultRecentFilesHistoryLimit);
/** 小于该字数的章节不纳入章节列表与导航 */
const chapterMinCharCount = ref(defaultChapterMinCharCount);
/** Monaco wrappingStrategy：advanced 换行更优、更重 */
const monacoAdvancedWrapping = ref(defaultMonacoAdvancedWrapping);
/** Monaco 阅读区平滑滚动（设置可关） */
const monacoSmoothScrolling = ref(defaultMonacoSmoothScrolling);
/** 全屏时阅读区域宽度（百分比） */
const fullscreenReaderWidthPercent = ref(defaultFullscreenReaderWidthPercent);
/** 电子书转换缓存目录；默认 userData/ConvertedTxt；设置里清空则为与源文件同目录 */
const ebookConvertOutputDir = ref(
  (() => {
    try {
      return window.colorTxt.getDefaultEbookConvertOutputDir();
    } catch {
      return "";
    }
  })(),
);
/** 电子书转换阶段（底栏显示「转换中…」） */
const ebookParsing = ref(false);
/** 转换进行中的电子书原路径（底栏路径；早于 currentFile 更新） */
const ebookConversionSourcePath = ref<string | null>(null);

const readerPaletteOverridesLight = ref<Partial<ReaderSurfacePalette>>({});
const readerPaletteOverridesDark = ref<Partial<ReaderSurfacePalette>>({});

const highlightColorsLight = ref<string[]>([...DEFAULT_HIGHLIGHT_COLORS_LIGHT]);
const highlightColorsDark = ref<string[]>([...DEFAULT_HIGHLIGHT_COLORS_DARK]);

const readerSurfaceLight = computed(() =>
  mergeReaderSurfacePalette(
    defaultReaderPaletteLight,
    readerPaletteOverridesLight.value,
  ),
);
const readerSurfaceDark = computed(() =>
  mergeReaderSurfacePalette(
    defaultReaderPaletteDark,
    readerPaletteOverridesDark.value,
  ),
);

const highlightColorsForReader = computed(() =>
  currentTheme.value === "vs"
    ? highlightColorsLight.value
    : highlightColorsDark.value,
);

const currentFileHighlightWords = computed(() => {
  const p = currentFile.value;
  if (!p) return undefined;
  return findFileMetaRecord(fileMetaRecords.value, p)?.highlightWordsByIndex;
});

const currentFileHighlightTerms = computed<
  Array<{ text: string; color: string; colorIndex: number }>
>(() => {
  const groups = currentFileHighlightWords.value;
  if (!groups) return [];
  const colors = highlightColorsForReader.value;
  const bodyText =
    currentTheme.value === "vs"
      ? readerSurfaceLight.value.bodyText
      : readerSurfaceDark.value.bodyText;
  const out: Array<{ text: string; color: string; colorIndex: number }> = [];
  for (const [idxKey, terms] of Object.entries(groups)) {
    const idx = Number.parseInt(idxKey, 10);
    if (!Number.isFinite(idx) || idx < 0) continue;
    const color = idx < colors.length ? colors[idx] : bodyText;
    for (const text of terms) {
      if (!text) continue;
      out.push({ text, color, colorIndex: idx });
    }
  }
  return out;
});

const readerPaneWrapRef = useTemplateRef<HTMLElement>("readerPaneWrapRef");
const {
  fullscreenReaderPaneStyle,
  onLayoutMouseDown: onFullscreenLayoutMouseDown,
  onLayoutWheel,
} = useAppFullscreenReaderLayout({
  isFullscreenView,
  readerRef,
  fullscreenSidebarOverlayRef,
  fullscreenReaderWidthPercent,
  readerPaneWrapRef,
});

function onLayoutMouseDown(ev: MouseEvent) {
  dismissFullscreenPanelsOnLayoutPointerDown(ev);
  onFullscreenLayoutMouseDown(ev);
}

const recentFiles = ref<RecentFileItem[]>([]);

/** 当前阅读位置（与 Monaco 可见区 probe 一致），用于会话恢复 */
const lastProbeLine = ref(1);
/** 视窗可见区首行 / 末行（Monaco 显示行号），用于阅读进度计算 */
const viewportTopLine = ref(1);
const viewportEndLine = ref(1);
/** 阅读区域滚动进度（0-100），按 scrollTop/maxScrollTop 计算 */
const viewportVisualProgressPercent = ref(0);
/** 阅读区域当前是否在底部（滚动意义） */
const viewportAtBottom = ref(false);
/** 流式加载结束后按源文件物理行号（含空行）恢复滚动；滤空时映射为显示行号 */
const pendingRestorePhysicalLine = ref<number | null>(null);
/** 流结束后 Monaco `restoreViewState`；与 pendingRestorePhysicalLine 二选一 */
const pendingRestoreEditorViewState = ref<unknown | null>(null);
/** 与视图状态同时恢复的视口首行物理行号锚点（用于恢复后校验） */
const pendingRestoreViewportTopPhysicalLine = ref<number | null>(null);
/** 与主进程 file:stream 的 requestId 对齐；resetSession 时清空，避免重复打开同一文件时旧 chunk 串入 */
const activeStreamRequestId = ref<number | null>(null);
const activeStreamFilePath = ref<string | null>(null);
/** 底栏路径与「在文件夹中显示」：电子书打开时为转换后的 `{原名}.txt` 路径 */
const physicalReaderPath = ref<string | null>(null);
/** 当前文件是否已完成加载与阅读位置同步；无打开文件时为 true，打开/重置会话后为 false，流结束并完成滚动后为 true */
const readingProgressSynced = ref(true);

let afterStreamFullTextInstalled: () => void | Promise<void> = async () => {};

const stream = useTxtStreamPipeline({
  readerRef,
  chapters,
  totalCharCount,
  totalLineCount,
  compressBlankLines,
  compressBlankKeepOneBlank,
  leadIndentFullWidth,
  afterFullTextInstalled: () => afterStreamFullTextInstalled(),
});

/** 侧栏文件列表是否处于编辑模式；编辑中不写文件列表缓存，退出时再落盘 */
const fileListEditing = ref(false);

const persistence = useAppPersistence({
  readerRef,
  stream,
  lastProbeLine,
  viewportEndLine,
  txtFiles,
  currentFile,
  readingProgressSynced,
  sidebarWidth,
  showSidebar,
  currentTheme,
  monacoCustomHighlight,
  compressBlankLines,
  compressBlankKeepOneBlank,
  txtrDelimitedMatchCrossLine,
  leadIndentFullWidth,
  showChapterCounts,
  readerFontSize,
  readerLineHeightMultiple,
  monacoFontFamily,
  chapterRuleState,
  recentFiles,
  restoreSessionOnStartup,
  recentFilesHistoryLimit,
  chapterMinCharCount,
  monacoAdvancedWrapping,
  monacoSmoothScrolling,
  fullscreenReaderWidthPercent,
  fileMetaRecords,
  shortcutBindings,
  defaultShortcutBindings,
  readerPaletteOverridesLight,
  readerPaletteOverridesDark,
  highlightColorsLight,
  highlightColorsDark,
  ebookConvertOutputDir,
  fileCategory,
  fileSort,
  fileCategoryCatalog,
  fileListEditing,
  syncCurrentFile,
});
const {
  persistSettings,
  clearRecentFiles,
  persistWindowUnloadState,
  persistFileListCache,
  persistFileMeta,
  persistRecentFiles,
  touchRecentFile,
  upsertBookmark,
  removeBookmark,
  clearBookmarks,
  initPersistenceBootstrap,
  applyRecentFilesHistoryLimitFromSettings,
  clearPersistedSession,
  metaProgressByPathKey,
} = persistence;

watch(fileListEditing, (editing, wasEditing) => {
  if (wasEditing === true && editing === false) {
    persistFileListCache();
  }
});

/** 加载期底栏/侧栏：当前文件的存档进度仅来自 file.meta */
const archivedProgressForCurrentFile = computed(() => {
  const cur = currentFile.value;
  if (!cur) return undefined;
  const key = fileHistoryKey(cur);
  const fromMap = metaProgressByPathKey.value.get(key);
  if (typeof fromMap === "number" && Number.isFinite(fromMap)) {
    return fromMap;
  }
  return undefined;
});

const { readingProgressParts } = useAppReadingProgress({
  totalLineCount,
  viewportTopLine,
  viewportEndLine,
  viewportVisualProgressPercent,
  currentFile,
  loading,
  readingProgressSynced,
  archivedProgressPercentForCurrentFile: archivedProgressForCurrentFile,
  physicalProgress: stream,
});

/** 与底栏 `readingProgressParts.percentValue` 一致，加载期用存档或 0%，避免当前行不显示 */
const liveReadingProgressForUi = computed<number | undefined>(() => {
  const v = readingProgressParts.value.percentValue;
  return typeof v === "number" ? v : undefined;
});

function onPersistUi() {
  persistSettings();
}

function onSetFilesCategory(paths: string[], category: string) {
  const set = new Set(paths);
  const cat = category.trim() ? category.trim() : undefined;
  const list = txtFiles.value;
  for (let i = 0; i < list.length; i++) {
    const f = list[i]!;
    if (!set.has(f.path)) continue;
    if (cat) {
      if (f.category === cat) continue;
      /** 原地改 `category`，保持对象引用，减少分配且仍能触发深度响应更新 */
      f.category = cat;
    } else {
      if (f.category === undefined) continue;
      delete f.category;
    }
  }
  if (!fileListEditing.value) {
    persistFileListCache();
  }
}

/** 侧栏筛选为具体分类时，新加入列表的文件自动归入该分类 */
function applyCurrentFileCategoryToNewPaths(paths: string[]) {
  const fc = fileCategory.value;
  if (
    fc === FILE_CATEGORY_FILTER_ALL ||
    fc === FILE_CATEGORY_FILTER_UNCATEGORIZED ||
    paths.length === 0
  ) {
    return;
  }
  onSetFilesCategory(paths, fc);
}

function onApplyCategoryCatalog(payload: {
  initial: CategoryEditorRow[];
  draft: CategoryEditorRow[];
  catalog: FileCategoryDefinition[];
}) {
  txtFiles.value = syncTxtFilesCategoriesAfterCatalogEdit(
    txtFiles.value,
    payload.initial,
    payload.draft,
  );
  fileCategoryCatalog.value = payload.catalog.map((c) => ({ ...c }));
  const fc = fileCategory.value;
  if (
    fc !== FILE_CATEGORY_FILTER_ALL &&
    fc !== FILE_CATEGORY_FILTER_UNCATEGORIZED &&
    !payload.catalog.some((c) => c.name === fc)
  ) {
    fileCategory.value = FILE_CATEGORY_FILTER_ALL;
  }
  if (!fileListEditing.value) {
    persistFileListCache();
  }
  persistSettings();
}

function replaceFileBaseName(filePath: string, newBaseName: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (idx < 0) return newBaseName;
  return `${filePath.slice(0, idx + 1)}${newBaseName}`;
}

async function onRenameFilePath(payload: { oldPath: string; newName: string }) {
  const oldPath = payload.oldPath.trim();
  const newName = payload.newName.trim();
  if (!oldPath || !newName) return;
  const targetPath = replaceFileBaseName(oldPath, newName);
  if (fileHistoryKey(targetPath) === fileHistoryKey(oldPath)) return;
  const result = await window.colorTxt.renamePath(oldPath, targetPath);
  if (!result.ok) {
    await appAlert(`重命名失败：${result.message}`);
    return;
  }

  const nextPath = result.path;
  const oldKey = fileHistoryKey(oldPath);
  const nextKey = fileHistoryKey(nextPath);
  txtFiles.value = txtFiles.value.map((f) => {
    if (fileHistoryKey(f.path) !== oldKey) return f;
    return normalizeTxtFileItem({
      ...f,
      path: nextPath,
      size: result.size,
    });
  });

  recentFiles.value = recentFiles.value.map((item) =>
    fileHistoryKey(item.path) === oldKey
      ? { ...item, path: nextPath }
      : item,
  );

  // file.meta 迁移：优先按旧路径精确匹配；若不存在再按旧文件名兜底（仅唯一候选时迁移，避免同名串数据）。
  let prevMeta = fileMetaRecords.value.find((m) => fileHistoryKey(m.path) === oldKey);
  if (!prevMeta) {
    const oldNameKey = fileNameKey(oldPath);
    const fallbackCandidates = fileMetaRecords.value.filter(
      (m) => m.fileName === oldNameKey,
    );
    if (fallbackCandidates.length === 1) {
      prevMeta = fallbackCandidates[0];
    }
  }
  if (prevMeta) {
    const prevMetaKey = fileHistoryKey(prevMeta.path);
    const migrated: FileMetaRecord = {
      ...prevMeta,
      path: nextPath,
      fileName: fileNameKey(nextPath),
      updatedAt: Date.now(),
    };
    fileMetaRecords.value = [
      migrated,
      ...fileMetaRecords.value.filter((m) => {
        const k = fileHistoryKey(m.path);
        if (k === prevMetaKey) return false;
        if (k === oldKey) return false;
        if (k === nextKey) return false;
        return true;
      }),
    ];
  }

  // 进度映射 key 基于 path，重命名后需迁移，否则 UI 可能仍引用旧路径进度。
  if (metaProgressByPathKey.value.has(oldKey)) {
    const m = new Map(metaProgressByPathKey.value);
    const v = m.get(oldKey);
    m.delete(oldKey);
    if (typeof v === "number") m.set(nextKey, v);
    metaProgressByPathKey.value = m;
  }

  if (currentFile.value && fileHistoryKey(currentFile.value) === oldKey) {
    currentFile.value = nextPath;
  }
  if (
    physicalReaderPath.value &&
    fileHistoryKey(physicalReaderPath.value) === oldKey
  ) {
    physicalReaderPath.value = nextPath;
  }
  if (
    activeStreamFilePath.value &&
    fileHistoryKey(activeStreamFilePath.value) === oldKey
  ) {
    activeStreamFilePath.value = nextPath;
  }

  persistFileListCache();
  persistRecentFiles();
  // 落盘时机保持原有策略：走现有防抖 + 门控；窗口卸载仍会兜底立即落盘。
  persistFileMeta();
}

function onOpenFileInNewWindow(path: string) {
  if (!path.trim()) return;
  window.colorTxt.openFileInNewWindow(path);
}

function onClearFileMeta(path: string) {
  const key = fileHistoryKey(path);
  const next = fileMetaRecords.value.filter((m) => fileHistoryKey(m.path) !== key);
  if (next.length === fileMetaRecords.value.length) return;
  fileMetaRecords.value = next;
  if (metaProgressByPathKey.value.has(key)) {
    const m = new Map(metaProgressByPathKey.value);
    m.delete(key);
    metaProgressByPathKey.value = m;
  }
  persistFileMeta();
}

/** 顶栏「更多」里最近文件：仅路径来自 recent，进度来自 meta（当前书用 live） */
const recentFilesForMenu = computed<RecentFileItem[]>(() => {
  const map = metaProgressByPathKey.value;
  const live = liveReadingProgressForUi.value;
  const cur = currentFile.value;
  const curKey = cur ? fileHistoryKey(cur) : "";
  return recentFiles.value.map((item) => {
    const k = fileHistoryKey(item.path);
    let progress: number | undefined;
    if (curKey && k === curKey && typeof live === "number") {
      progress = live;
    } else {
      progress = map.get(k);
    }
    return { path: item.path, progress };
  });
});

void initPersistenceBootstrap().catch(() => {
  // 启动引导失败时不阻断应用；目录兜底见 useAppPersistence
});

const {
  pinActive,
  canPin,
  canBookmark,
  addBookmarkOpen,
  removeBookmarkOpen,
  bookmarkNoteInput,
  bookmarkNoteInputRef,
  editingBookmarkLine,
  activeBookmarkInViewport,
  activeBookmarkLine,
  bookmarkActive,
  bookmarkListItems,
  onPinClick,
  ensurePinBeforeRevealFindWidget,
  onGoBackFromPin,
  onBookmarkClick,
  confirmAddBookmark,
  confirmRemoveActiveBookmark,
  jumpToBookmark,
  clearCurrentFileBookmarks,
  removeCurrentFileBookmarks,
  onEditBookmark,
  onRemoveBookmark,
} = useAppBookmarkPins({
  readerRef,
  stream,
  currentFile,
  loading,
  totalLineCount,
  fileMetaRecords,
  lastProbeLine,
  viewportEndLine,
  sidebarTab,
  pulseBookmarkListCenter,
  upsertBookmark,
  removeBookmark,
  clearBookmarks,
});

provide(bookmarkNoteInputRefKey, bookmarkNoteInputRef);

const fileSession = useAppFileSession({
  readerRef,
  readerSidebarRef,
  stream,
  persistence,
  chapterSync,
  currentFile,
  loading,
  loadingProgressPercent,
  dirListScanning,
  dirListCurrentName,
  fileEncoding,
  currentFileSize,
  totalCharCount,
  totalLineCount,
  chapters,
  activeChapterIdx,
  sidebarTab,
  txtFiles,
  lastProbeLine,
  viewportTopLine,
  viewportEndLine,
  pendingRestorePhysicalLine,
  pendingRestoreEditorViewState,
  pendingRestoreViewportTopPhysicalLine,
  recentFiles,
  restoreSessionOnStartup,
  activeStreamRequestId,
  activeStreamFilePath,
  physicalReaderPath,
  readingProgressSynced,
  ebookConvertOutputDir,
  ebookParsing,
  ebookConversionSourcePath,
  applyCurrentFileCategoryIfConcrete: applyCurrentFileCategoryToNewPaths,
});

const {
  clearFileList,
  clearFileListForCategory,
  removeFileList,
  closeCurrentFile,
  openFileViaDialog,
  openFileFromSidebar,
  pickTxtDirectory,
  importPathsIntoFileList,
  openFilePath,
  openRecentFileFromHistory,
} = fileSession;

useAppSyncCurrentFileWatch({
  syncCurrentFile,
  physicalReaderPath,
  currentFile,
  loading,
  readingProgressSynced,
  ebookParsing,
  stream,
  viewportEndLine,
  openFilePath,
});

async function onImportDroppedPathsFromList(paths: string[]) {
  readerDropOverlayVisible.value = false;
  await importPathsIntoFileList(paths);
}

const footerPathCaption = computed(() => {
  if (ebookParsing.value && ebookConversionSourcePath.value) {
    return ebookConversionSourcePath.value;
  }
  return physicalReaderPath.value ?? currentFile.value ?? "";
});

const chapterNav = useAppChapterNavigation({
  readerRef,
  chapters,
  activeChapterIdx,
  lastProbeLine,
  viewportTopLine,
  viewportEndLine,
  currentFile,
  readingProgressSynced,
  stream,
  touchRecentFile,
  chapterListScrollSmooth,
  chapterRuleState,
  chapterMinCharCount,
  chapterRuleErrorText,
  showChapterRulePanel,
  sidebarTab,
  persistSettings,
  openFilePath,
});

afterStreamFullTextInstalled = async () => {
  await readerRef.value?.applyEmbeddedImageAnchors(physicalReaderPath.value);
  readerRef.value?.applyEbookInternalLinkMarkers?.();
  stream.resyncMirrorFromReader();
  chapterNav.rebuildChaptersFromCurrentText();
};

const {
  jumpToChapter,
  jumpToPrevChapter,
  jumpToNextChapter,
  onProbeLineChange,
  applyChapterMatchRules,
} = chapterNav;

const readerUi = useAppReaderUiPrefs({
  readerRef,
  readerFontSize,
  readerLineHeightMultiple,
  monacoFontFamily,
  monacoCustomHighlight,
  monacoAdvancedWrapping,
  compressBlankLines,
  leadIndentFullWidth,
  currentFile,
  stream,
  persistSettings,
  openFilePath,
  isFullscreenView,
  showFullscreenHeader,
  viewportTopLine,
  viewportEndLine,
  viewportVisualProgressPercent,
  viewportAtBottom,
});

const {
  onViewportTopLineChange,
  onViewportEndLineChange,
  onViewportVisualProgressChange,
  increaseFontSize,
  decreaseFontSize,
  increaseLineHeight,
  decreaseLineHeight,
  setMonacoFontFamily,
  toggleMonacoCustomHighlight,
  toggleMonacoAdvancedWrapping,
  toggleCompressBlankLines,
  toggleLeadIndentFullWidth,
  onToggleFind,
} = readerUi;

function openGithubRepo() {
  void window.colorTxt.openExternal(GITHUB_REPO_URL);
}

function requestCheckForUpdates() {
  void appOverlaysRef.value?.checkForUpdates();
}

function openNewWindow() {
  window.colorTxt.openNewWindow();
}

async function applyShortcutBindings(next: ShortcutBindingMap) {
  const merged = mergeShortcutBindings(defaultShortcutBindings, next);
  const globalResult = await window.colorTxt.setGlobalShortcut(
    merged.toggleAllWindowsVisibility,
  );
  if (!globalResult.ok) {
    await appAlert(globalResult.message || "系统级快捷键设置失败");
    return;
  }
  shortcutBindings.value = merged;
  persistSettings();
}

function revealCurrentFileInFolder() {
  const filePath =
    physicalReaderPath.value ??
    currentFile.value ??
    ebookConversionSourcePath.value;
  if (!filePath) return;
  void window.colorTxt.showItemInFolder(filePath).catch(() => {});
}

function quitApp() {
  window.colorTxt.quitApp();
}

function refreshReaderSurfaceAfterPaletteChange() {
  applyReaderSurfaceToDocument(
    currentTheme.value,
    readerSurfaceLight.value,
    readerSurfaceDark.value,
  );
  readerRef.value?.setTheme(currentTheme.value);
}

function onApplyReaderPalettes(payload: {
  light: ReaderSurfacePalette;
  dark: ReaderSurfacePalette;
}) {
  readerPaletteOverridesLight.value = overridesFromFullPalette(
    payload.light,
    defaultReaderPaletteLight,
  );
  readerPaletteOverridesDark.value = overridesFromFullPalette(
    payload.dark,
    defaultReaderPaletteDark,
  );
  persistSettings();
  refreshReaderSurfaceAfterPaletteChange();
}

function onApplyHighlightColors(payload: { light: string[]; dark: string[] }) {
  highlightColorsLight.value = mergeHighlightColors(
    DEFAULT_HIGHLIGHT_COLORS_LIGHT,
    payload.light.length >= MIN_HIGHLIGHT_COLORS ? payload.light : undefined,
  );
  highlightColorsDark.value = mergeHighlightColors(
    DEFAULT_HIGHLIGHT_COLORS_DARK,
    payload.dark.length >= MIN_HIGHLIGHT_COLORS ? payload.dark : undefined,
  );
  persistSettings();
}

function onAddHighlightTerm(payload: { text: string; colorIndex: number }) {
  const path = currentFile.value;
  if (!path) return;
  fileMetaRecords.value = assignHighlightTermToColorForFile(
    fileMetaRecords.value,
    path,
    payload.colorIndex,
    payload.text,
  );
  persistFileMeta();
}

function onRemoveHighlightTerm(payload: { text: string }) {
  const path = currentFile.value;
  if (!path) return;
  fileMetaRecords.value = removeHighlightTermFromFile(
    fileMetaRecords.value,
    path,
    payload.text,
  );
  persistFileMeta();
}

async function clearCurrentFileHighlightTerms() {
  const path = currentFile.value;
  if (!path) return;
  const confirmed = await window.colorTxt.confirmClearHighlightTerms();
  if (!confirmed) return;
  fileMetaRecords.value = upsertFileMetaRecord(
    fileMetaRecords.value,
    path,
    () => ({ highlightWordsByIndex: undefined }),
  );
  persistFileMeta();
}

function onFindHighlightTermFromSidebar(text: string) {
  if (!currentFile.value || loading.value || totalLineCount.value <= 0) return;
  ensurePinBeforeRevealFindWidget();
  readerRef.value?.jumpToNextInlineSearchMatch?.(text, {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
    smooth: true,
  });
}

function clearSidebarSearchState() {
  searchQuery.value = "";
  searchResults.value = [];
  searchInProgress.value = false;
  activeSearchResultPhysicalLine.value = null;
  searchRunToken += 1;
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  readerRef.value?.clearInlineSearchState?.();
}

function isWordChar(ch: string): boolean {
  return /[0-9A-Za-z_]/.test(ch);
}

function isWholeWordBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : "";
  const after = end < text.length ? text[end] : "";
  const leftOk = before === "" || !isWordChar(before);
  const rightOk = after === "" || !isWordChar(after);
  return leftOk && rightOk;
}

function collectPlainRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<{ start: number; end: number }> {
  const source = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Array<{ start: number; end: number }> = [];
  if (!needle) return out;
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx < 0) break;
    const end = idx + needle.length;
    if (!wholeWord || isWholeWordBoundary(text, idx, end)) {
      out.push({ start: idx, end });
    }
    from = end;
  }
  return out;
}

function collectRegexRanges(
  text: string,
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<{ start: number; end: number }> | null {
  const flags = caseSensitive ? "g" : "gi";
  let reg: RegExp;
  try {
    reg = new RegExp(query, flags);
  } catch {
    return null;
  }
  const out: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null = null;
  while ((match = reg.exec(text)) != null) {
    const matched = match[0] ?? "";
    const start = match.index;
    const end = start + matched.length;
    if (matched.length === 0) {
      reg.lastIndex = start + 1;
      continue;
    }
    if (!wholeWord || isWholeWordBoundary(text, start, end)) {
      out.push({ start, end });
    }
  }
  return out;
}

function runSidebarSearch(token: number) {
  if (token !== searchRunToken) return;
  const q = searchQuery.value.trim();
  if (!currentFile.value || !q) {
    searchResults.value = [];
    searchInProgress.value = false;
    return;
  }
  const caseSensitive = searchMatchCase.value;
  const wholeWord = searchWholeWord.value;
  const useRegex = searchUseRegex.value;
  const maxLine = stream.getPhysicalLineCount();
  const next: SidebarSearchResult[] = [];
  for (let line = 1; line <= maxLine; line += 1) {
    const text = stream.getPhysicalLineContent(line);
    const ranges = useRegex
      ? collectRegexRanges(text, q, caseSensitive, wholeWord)
      : collectPlainRanges(text, q, caseSensitive, wholeWord);
    if (ranges == null) {
      searchResults.value = [];
      activeSearchResultPhysicalLine.value = null;
      searchInProgress.value = false;
      return;
    }
    if (ranges.length === 0) continue;
    next.push({
      physicalLine: line,
      displayLine: stream.physicalLineToDisplayForReader(line),
      text,
      ranges,
    });
    if (next.length >= SEARCH_RESULT_LIMIT) break;
  }
  if (token !== searchRunToken) return;
  searchResults.value = next;
  readerRef.value?.setInlineSearchState?.(q, null, {
    caseSensitive: caseSensitive,
    wholeWord: wholeWord,
    useRegex: useRegex,
  });
  if (
    activeSearchResultPhysicalLine.value != null &&
    !next.some((it) => it.physicalLine === activeSearchResultPhysicalLine.value)
  ) {
    activeSearchResultPhysicalLine.value = null;
  }
  searchInProgress.value = false;
}

function scheduleSidebarSearch() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  const q = searchQuery.value.trim();
  if (!currentFile.value || !q) {
    searchResults.value = [];
    searchInProgress.value = false;
    activeSearchResultPhysicalLine.value = null;
    readerRef.value?.clearInlineSearchState?.();
    return;
  }
  const token = ++searchRunToken;
  searchInProgress.value = true;
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    runSidebarSearch(token);
  }, SEARCH_DEBOUNCE_MS);
}

watch(searchQuery, () => {
  scheduleSidebarSearch();
});

watch([searchMatchCase, searchWholeWord, searchUseRegex], () => {
  scheduleSidebarSearch();
});

watch(totalLineCount, () => {
  if (!searchQuery.value.trim()) return;
  scheduleSidebarSearch();
});

watch(currentFile, (next, prev) => {
  if (next === prev) return;
  clearSidebarSearchState();
});

function onJumpToSearchResult(item: SidebarSearchResult) {
  if (!currentFile.value || loading.value || totalLineCount.value <= 0) return;
  activeSearchResultPhysicalLine.value = item.physicalLine;
  ensurePinBeforeRevealFindWidget();
  const displayLine = stream.physicalLineToDisplayForReader(item.physicalLine);
  const primaryRange = item.ranges[0];
  const startColumn = primaryRange ? primaryRange.start + 1 : 1;
  const endColumn = primaryRange
    ? Math.max(startColumn + 1, primaryRange.end + 1)
    : startColumn + 1;
  readerRef.value?.setInlineSearchState?.(searchQuery.value, {
    lineNumber: displayLine,
    startColumn,
    endColumn,
  }, {
    caseSensitive: searchMatchCase.value,
    wholeWord: searchWholeWord.value,
    useRegex: searchUseRegex.value,
  });
  readerRef.value?.jumpToSearchMatchCentered?.(
    displayLine,
    startColumn,
    endColumn,
  );
  queueMicrotask(() => readerRef.value?.emitProbeLine?.());
}

onBeforeUnmount(() => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  activeSearchResultPhysicalLine.value = null;
  readerRef.value?.clearInlineSearchState?.();
});

function applySettings(payload: SettingsApplyPayload) {
  const prevCompressBlankKeepOneBlank = compressBlankKeepOneBlank.value;
  const prevChapterMinCharCount = chapterMinCharCount.value;
  monacoSmoothScrolling.value = payload.monacoSmoothScrolling;
  compressBlankKeepOneBlank.value = payload.compressBlankKeepOneBlank;
  txtrDelimitedMatchCrossLine.value = payload.txtrDelimitedMatchCrossLine;
  restoreSessionOnStartup.value = payload.restoreSessionOnStartup;
  syncCurrentFile.value = payload.syncCurrentFile;
  recentFilesHistoryLimit.value = Math.max(
    0,
    Math.min(
      maxRecentFilesHistoryLimit,
      Math.floor(payload.recentFilesHistoryLimit),
    ),
  );
  chapterMinCharCount.value = Math.max(
    minChapterMinCharCount,
    Math.min(maxChapterMinCharCount, Math.floor(payload.chapterMinCharCount)),
  );
  fullscreenReaderWidthPercent.value = Math.max(
    minFullscreenReaderWidthPercent,
    Math.min(
      maxFullscreenReaderWidthPercent,
      Math.floor(payload.fullscreenReaderWidthPercent),
    ),
  );
  ebookConvertOutputDir.value = payload.ebookConvertOutputDir;
  const nextFontSize = Math.max(
    minFontSize,
    Math.min(maxFontSize, Math.round(payload.fontSize)),
  );
  const nextLineHeightMultiple = clampLineHeightMultipleForFontSize(
    nextFontSize,
    payload.lineHeightMultiple,
  );
  readerFontSize.value = nextFontSize;
  readerLineHeightMultiple.value = nextLineHeightMultiple;
  readerRef.value?.setFontSize(nextFontSize);
  readerRef.value?.setLineHeightMultiple(nextLineHeightMultiple);
  persistSettings();
  if (!payload.restoreSessionOnStartup) {
    clearPersistedSession();
  }
  applyRecentFilesHistoryLimitFromSettings();
  readerRef.value?.setWrappingStrategyAdvanced(monacoAdvancedWrapping.value);
  showSettingsPanel.value = false;
  if (prevChapterMinCharCount !== chapterMinCharCount.value) {
    chapterNav.rebuildChaptersFromCurrentText();
  }

  if (
    prevCompressBlankKeepOneBlank !== compressBlankKeepOneBlank.value &&
    compressBlankLines.value &&
    currentFile.value
  ) {
    const path = currentFile.value;
    const physicalP = stream.viewportDisplayLineToPhysicalLine(
      viewportEndLine.value,
    );
    void openFilePath(path, {
      restorePhysicalLine: physicalP,
      skipRememberCurrent: true,
      keepSidebarTab: true,
    }).then((ok) => {
      if (!ok) {
        compressBlankKeepOneBlank.value = prevCompressBlankKeepOneBlank;
        persistSettings();
      }
    });
  }
}

/** 来自主进程的跨窗口主题同步，避免再发 theme:set 造成循环 */
const skipNextThemeNativeIpc = ref(false);

useAppWindowBindings({
  readerRef,
  stream,
  fileSession,
  persistWindowUnloadState,
  persistFileListCache,
  persistSettings,
  isFullscreenView,
  showSidebar,
  sidebarWidth,
  fullscreenSidebarWidth,
  resizingSidebar,
  getSidebarMaxWidth,
  getSidebarMinWidth,
  clampSidebarWidthToViewport,
  updateFullscreenHeaderHover,
  updateFullscreenFooterHover,
  updateFullscreenSidebarHover,
  endSidebarResize,
  dismissFullscreenChromeForNativeExit,
  bumpFullscreenCursorIdle,
  recordFullscreenPointer,
  enterOrExitFullscreenView,
  pulseChapterListCenter,
  currentTheme,
  readerFontSize,
  readerLineHeightMultiple,
  monacoFontFamily,
  fileEncoding,
  loading,
  loadingProgressPercent,
  pendingRestorePhysicalLine,
  pendingRestoreEditorViewState,
  pendingRestoreViewportTopPhysicalLine,
  compressBlankLines,
  suppressFileListCenterAfterLoad,
  txtFiles,
  sidebarTab,
  currentFile,
  dirListScanning,
  dirListCurrentName,
  chapterRuleErrorText,
  showChapterRulePanel,
  increaseFontSize,
  decreaseFontSize,
  increaseLineHeight,
  decreaseLineHeight,
  openNewWindow,
  openFileViaDialog,
  pickTxtDirectory,
  onBookmarkClick,
  skipNextThemeNativeIpc,
  jumpToPrevChapter,
  jumpToNextChapter,
  openSettings: () => {
    showSettingsPanel.value = true;
  },
  openColorScheme: () => {
    showColorSchemePanel.value = true;
  },
  toggleFind: onToggleFind,
  scrollDownLine: () => readerRef.value?.scrollByLineStep?.(1),
  scrollUpLine: () => readerRef.value?.scrollByLineStep?.(-1),
  scrollPageUp: () => readerRef.value?.scrollByPageStep?.(-1),
  scrollPageDown: () => readerRef.value?.scrollByPageStep?.(1),
  shortcutBindings,
  activeStreamRequestId,
  activeStreamFilePath,
  readingProgressSynced,
  readerDropOverlayVisible,
});

useAppShellThemeWatch({
  currentTheme,
  readerRef,
  readerSurfaceLight,
  readerSurfaceDark,
  skipNextThemeNativeIpc,
  persistSettings,
  showChapterCounts,
  currentFile,
  isFullscreenView,
  showFullscreenSidebar,
  pulseChapterListCenter,
});
</script>

<template>
  <div
    ref="appRoot"
    class="app"
    :class="{
      fullscreen: isFullscreenView,
      'fullscreen--cursorHidden': isFullscreenView && fullscreenCursorHidden,
    }"
  >
    <div
      :ref="setFullscreenHeaderOverlayEl"
      class="appHeaderWrap"
      v-show="!isFullscreenView || showFullscreenHeader"
      @mouseleave="onFullscreenHeaderMouseLeave"
    >
      <AppHeader
        :in-fullscreen="isFullscreenView"
        :recent-files="recentFilesForMenu"
        :pin-active="pinActive"
        :can-pin="canPin"
        :bookmark-active="bookmarkActive"
        :can-bookmark="canBookmark"
        :current-theme="currentTheme"
        :show-sidebar="showSidebar"
        :can-increase-font="readerFontSize < maxFontSize"
        :can-decrease-font="readerFontSize > minFontSize"
        :can-increase-line-height="
          readerLineHeightMultiple <
          maxLineHeightMultipleForFontSize(readerFontSize) - 1e-6
        "
        :can-decrease-line-height="
          readerLineHeightMultiple > minLineHeightMultiple + 1e-6
        "
        :monaco-font-family="monacoFontFamily"
        :monaco-advanced-wrapping="monacoAdvancedWrapping"
        :monaco-custom-highlight="monacoCustomHighlight"
        :compress-blank-lines="compressBlankLines"
        :lead-indent-full-width="leadIndentFullWidth"
        :shortcut-bindings="shortcutBindings"
        @open-file="openFileViaDialog"
        @pin-click="onPinClick"
        @bookmark-click="onBookmarkClick"
        @go-back-from-pin="onGoBackFromPin"
        @change-theme="currentTheme = $event"
        @toggle-sidebar="showSidebar = !showSidebar"
        @toggle-fullscreen="enterOrExitFullscreenView"
        @set-monaco-font="setMonacoFontFamily"
        @increase-font-size="increaseFontSize"
        @decrease-font-size="decreaseFontSize"
        @increase-line-height="increaseLineHeight"
        @decrease-line-height="decreaseLineHeight"
        @toggle-monaco-advanced-wrapping="toggleMonacoAdvancedWrapping"
        @toggle-monaco-custom-highlight="toggleMonacoCustomHighlight"
        @toggle-compress-blank-lines="toggleCompressBlankLines"
        @toggle-lead-indent-full-width="toggleLeadIndentFullWidth"
        @toggle-find="onToggleFind"
        @open-chapter-rules="
          chapterRuleErrorText = '';
          showChapterRulePanel = true;
        "
        @open-github="openGithubRepo"
        @check-for-updates="requestCheckForUpdates"
        @open-shortcuts="showShortcutPanel = true"
        @open-settings="showSettingsPanel = true"
        @open-color-scheme="showColorSchemePanel = true"
        @open-new-window="openNewWindow"
        @open-recent-file="openRecentFileFromHistory"
        @clear-recent-files="clearRecentFiles"
        @open-about="showAboutPanel = true"
        @quit-app="quitApp"
      />
    </div>

    <div
      class="layout"
      @mousedown="onLayoutMouseDown"
      @wheel.capture="onLayoutWheel"
    >
      <div
        ref="fullscreenSidebarOverlayRef"
        class="sidebarPaneWrap"
        :class="{ 'sidebarPaneWrap--fullscreen': isFullscreenView }"
        v-show="sidebarShellVisible"
        :style="{ width: `${sidebarPaneLayoutWidth}px` }"
        @mouseleave="onFullscreenSidebarMouseLeave"
      >
        <ReaderSidebar
          ref="readerSidebarRef"
          active-scroll-mode="center"
          :panel-expanded="isFullscreenView || showSidebar"
          :activity-icons-on-dark="currentTheme === 'vs-dark'"
          :in-fullscreen="isFullscreenView"
          :show-fullscreen-sidebar="
            isFullscreenView ? showFullscreenSidebar : undefined
          "
          :chapter-list-scroll-smooth="chapterListScrollSmooth"
          :should-center-chapter-list="shouldCenterChapterList"
          :should-center-file-list="shouldCenterFileList"
          :should-center-bookmark-list="shouldCenterBookmarkList"
          v-model:activeTab="sidebarTab"
          v-model:showChapterCounts="showChapterCounts"
          :files="txtFiles"
          :file-meta-records="fileMetaRecords"
          :file-category="fileCategory"
          :file-sort="fileSort"
          :file-category-catalog="fileCategoryCatalog"
          :meta-progress-by-path-key="metaProgressByPathKey"
          :live-reading-progress-percent="liveReadingProgressForUi"
          :bookmarks="bookmarkListItems"
          :highlight-terms="currentFileHighlightTerms"
          :search-query="searchQuery"
          :search-results="searchResults"
          :search-in-progress="searchInProgress"
          :search-match-case="searchMatchCase"
          :search-whole-word="searchWholeWord"
          :search-use-regex="searchUseRegex"
          :active-search-result-physical-line="activeSearchResultPhysicalLine"
          :highlight-preview-bg="
            currentTheme === 'vs'
              ? readerSurfaceLight.readerBg
              : readerSurfaceDark.readerBg
          "
          :monaco-font-family="monacoFontFamily"
          :active-bookmark-line="activeBookmarkLine"
          :current-file-path="currentFile"
          :chapters="chapters"
          :active-chapter-idx="activeChapterIdx"
          :format-char-count="formatCharCount"
          @pick-directory="pickTxtDirectory"
          @import-dropped-paths="onImportDroppedPathsFromList"
          @open-file="openFileFromSidebar"
          @jump-to-chapter="jumpToChapter"
          @clear-file-list="clearFileList"
          @clear-file-list-category="clearFileListForCategory"
          @remove-file-list="removeFileList"
          @clear-file-meta="onClearFileMeta"
          @rename-file-path="onRenameFilePath"
          @open-file-in-new-window="onOpenFileInNewWindow"
          @close-current-file="closeCurrentFile"
          @jump-to-bookmark="jumpToBookmark"
          @clear-bookmarks="clearCurrentFileBookmarks"
          @remove-bookmarks="removeCurrentFileBookmarks"
          @edit-bookmark="onEditBookmark"
          @remove-bookmark="onRemoveBookmark"
          @find-highlight-term="onFindHighlightTermFromSidebar"
          @update:search-query="searchQuery = $event"
          @update:search-match-case="searchMatchCase = $event"
          @update:search-whole-word="searchWholeWord = $event"
          @update:search-use-regex="searchUseRegex = $event"
          @jump-to-search-result="onJumpToSearchResult"
          @remove-highlight-term="onRemoveHighlightTerm({ text: $event })"
          @clear-highlights="clearCurrentFileHighlightTerms"
          @persist-ui="onPersistUi"
          @update:file-category="fileCategory = $event"
          @update:file-sort="fileSort = $event"
          @apply-category-catalog="onApplyCategoryCatalog"
          @set-files-category="onSetFilesCategory"
          @update:fullscreen-file-list-popovers-open="
            fullscreenFileListPopoversOpen = $event
          "
          @update:file-list-editing="fileListEditing = $event"
          @request-expand-panel="showSidebar = true"
          @request-collapse-panel="showSidebar = false"
          @open-color-scheme="showColorSchemePanel = true"
          @open-settings="showSettingsPanel = true"
        />
        <!-- 放在侧栏容器内，避免移到拖条时触发 @mouseleave 导致全屏侧栏收起 -->
        <div
          v-show="isFullscreenView"
          class="resizer resizer--fullscreenSidebar"
          @mousedown="startResizeSidebar"
        ></div>
      </div>
      <div
        v-show="showSidebar && !isFullscreenView"
        class="resizer"
        :style="{ left: `${sidebarWidthForLayout - 3}px` }"
        @mousedown="startResizeSidebar"
      ></div>
      <div
        ref="readerPaneWrapRef"
        class="readerPaneWrap"
        data-drop-zone="reader"
        :style="fullscreenReaderPaneStyle"
      >
        <Transition name="readerDropOverlay">
          <div
            v-if="readerDropOverlayVisible"
            class="readerDropOverlay"
            aria-hidden="true"
          >
            <p class="readerDropOverlayText">打开文件</p>
          </div>
        </Transition>
        <ReaderMain
          ref="readerRef"
          class="readerPane"
          :monaco-custom-highlight="monacoCustomHighlight"
          :txtr-delimited-match-cross-line="txtrDelimitedMatchCrossLine"
          :compress-blank-lines="compressBlankLines"
          :monaco-advanced-wrapping="monacoAdvancedWrapping"
          :monaco-smooth-scrolling="monacoSmoothScrolling"
          :stream-loading="loading"
          :reader-surface-light="readerSurfaceLight"
          :reader-surface-dark="readerSurfaceDark"
          :highlight-colors="highlightColorsForReader"
          :highlight-words-by-index="currentFileHighlightWords"
          :reader-file-path="currentFile"
          :ebook-anchor-physical-to-display="
            stream.physicalLineToDisplayForReader
          "
          :ebook-display-line-to-physical="
            stream.viewportDisplayLineToPhysicalLine
          "
          :before-reveal-find-widget="ensurePinBeforeRevealFindWidget"
          @probe-line-change="onProbeLineChange"
          @viewport-top-line-change="onViewportTopLineChange"
          @viewport-end-line-change="onViewportEndLineChange"
          @viewport-visual-progress-change="onViewportVisualProgressChange"
          @add-highlight-term="onAddHighlightTerm"
          @remove-highlight-term="onRemoveHighlightTerm"
        />
        <div
          v-if="showReaderIdleHint"
          class="readerIdleHint"
          aria-hidden="true"
        >
          <div>{{ defaultReaderIdleHint }}</div>
          <p>{{ defaultReaderOpenHint }}</p>
        </div>
        <div
          v-if="showReaderBusyHint"
          class="readerIdleHint"
          aria-live="polite"
        >
          {{ readerBusyHintText }}
        </div>
        <div
          v-if="showReaderEmptyHint"
          class="readerIdleHint"
          aria-hidden="true"
        >
          {{ emptyFileHintText }}
        </div>
      </div>
    </div>
    <div
      v-if="showFullscreenTip"
      class="fullscreenTip"
      :class="{ fading: fullscreenTipFading }"
    >
      按 ESC 退出全屏
    </div>

    <div
      :ref="setFullscreenFooterOverlayEl"
      class="appFooterWrap"
      v-show="!isFullscreenView || showFullscreenFooter"
      @mouseleave="onFullscreenFooterMouseLeave"
    >
      <AppFooter
        :loading="loading"
        :loading-progress-percent="loadingProgressPercent"
        :ebook-parsing="ebookParsing"
        :current-file="currentFile"
        :path-caption="footerPathCaption"
        :reading-progress-percent-part="readingProgressParts.percentPart"
        :reading-progress-detail-part="readingProgressParts.detailPart"
        :reading-progress-placeholder="readingProgressParts.placeholder"
        :reading-progress-complete="readingProgressParts.complete"
        :total-char-count-text="formatCharCount(totalCharCount)"
        :file-size-text="formatFileSize(currentFileSize)"
        :file-encoding="fileEncoding"
        @reveal-file-in-folder="revealCurrentFileInFolder"
      />
    </div>

    <AppAlertHost />

    <AppOverlays
      ref="appOverlaysRef"
      v-model:show-about-panel="showAboutPanel"
      v-model:show-shortcut-panel="showShortcutPanel"
      v-model:show-settings-panel="showSettingsPanel"
      v-model:show-color-scheme-panel="showColorSchemePanel"
      v-model:show-chapter-rule-panel="showChapterRulePanel"
      v-model:add-bookmark-open="addBookmarkOpen"
      v-model:remove-bookmark-open="removeBookmarkOpen"
      v-model:bookmark-note-input="bookmarkNoteInput"
      :restore-session-on-startup="restoreSessionOnStartup"
      :sync-current-file="syncCurrentFile"
      :recent-files-history-limit="recentFilesHistoryLimit"
      :chapter-min-char-count="chapterMinCharCount"
      :fullscreen-reader-width-percent="fullscreenReaderWidthPercent"
      :reader-font-size="readerFontSize"
      :reader-line-height-multiple="readerLineHeightMultiple"
      :compress-blank-keep-one-blank="compressBlankKeepOneBlank"
      :monaco-smooth-scrolling="monacoSmoothScrolling"
      :monaco-custom-highlight="monacoCustomHighlight"
      :txtr-delimited-match-cross-line="txtrDelimitedMatchCrossLine"
      :chapter-rules="chapterRuleState.rules"
      :chapter-rule-error-text="chapterRuleErrorText"
      :editing-bookmark-line="editingBookmarkLine"
      :active-bookmark-in-viewport="activeBookmarkInViewport"
      :dir-list-scanning="dirListScanning"
      :dir-list-current-name="dirListCurrentName"
      :ebook-parsing="ebookParsing"
      :shortcut-bindings="shortcutBindings"
      :default-shortcut-bindings="defaultShortcutBindings"
      :current-theme="currentTheme"
      :reader-surface-light="readerSurfaceLight"
      :reader-surface-dark="readerSurfaceDark"
      :monaco-font-family="monacoFontFamily"
      :highlight-colors-light="highlightColorsLight"
      :highlight-colors-dark="highlightColorsDark"
      :ebook-convert-output-dir="ebookConvertOutputDir"
      @apply-settings="applySettings"
      @apply-shortcut-bindings="applyShortcutBindings"
      @apply-chapter-rules="applyChapterMatchRules"
      @confirm-add-bookmark="confirmAddBookmark"
      @confirm-remove-active-bookmark="confirmRemoveActiveBookmark"
      @apply-reader-palettes="onApplyReaderPalettes"
      @apply-highlight-colors="onApplyHighlightColors"
    />
  </div>
</template>

<style scoped src="./appShell.css"></style>
