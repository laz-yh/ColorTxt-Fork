<script setup lang="ts">
import { computed, ref } from "vue";
import type { Chapter } from "../chapter";
import { useReaderSidebarLists } from "../composables/useReaderSidebarLists";
import type {
  FileCategoryDefinition,
  FileSortMode,
} from "../constants/fileCategories";
import { SIDEBAR_ACTIVITY_BAR_WIDTH } from "../constants/appUi";
import type { TxtFileItem } from "../services/fileListService";
import type { SidebarFileItem } from "../composables/useReaderSidebarLists";
import type { CategoryEditorRow } from "../constants/fileCategories";
import type { FileMetaRecord } from "../stores/fileMetaStore";
import SwitchToggle from "./SwitchToggle.vue";
import ChapterListPanel from "./ChapterListPanel.vue";
import FileListPanel from "./FileListPanel.vue";
import BookmarkListPanel from "./BookmarkListPanel.vue";
import HighlightListPanel from "./HighlightListPanel.vue";
import { icons } from "../icons";
import {
  collectFsPathsFromDataTransfer,
  dataTransferLikelyHasExternalFiles,
} from "../utils/dragDropFsPaths";

const props = withDefaults(
  defineProps<{
    activeTab: "files" | "chapters" | "bookmarks" | "highlights";
    /** 非全屏时是否展开右侧面板列；全屏时由 App 固定为 true */
    panelExpanded?: boolean;
    chapters: Chapter[];
    files: TxtFileItem[];
    /** 来自 file.meta 的阅读进度映射（路径 key → 百分比） */
    metaProgressByPathKey?: Map<string, number>;
    /** 与 `files` 对应的 meta 行（分类、打开时间、排序用进度等） */
    fileMetaRecords?: readonly FileMetaRecord[];
    /** 当前打开文件的实时进度（%），滚动时更新 */
    liveReadingProgressPercent?: number;
    highlightTerms?: Array<{ text: string; color: string; colorIndex: number }>;
    highlightPreviewBg?: string;
    monacoFontFamily?: string;
    bookmarks: Array<{ line: number; note?: string; content: string }>;
    currentFilePath: string | null;
    activeChapterIdx: number;
    activeBookmarkLine?: number | null;
    showChapterCounts: boolean;
    formatCharCount: (n: number) => string;
    /** edge：滚入可见区；center：当前项在列表视口垂直居中（全屏浮动侧栏） */
    activeScrollMode?: "edge" | "center";
    /** 全屏浮动侧栏时章节列表不使用平滑滚动（避免与呼出动画叠加） */
    inFullscreen?: boolean;
    /** 全屏浮动侧栏是否展开（用于文件列表 Teleport 浮层随侧栏收起而关闭） */
    showFullscreenSidebar?: boolean;
    /** 章节列表当前项是否平滑滚入视口（由 App 在阅读滚动导致换章时置为 true） */
    chapterListScrollSmooth?: boolean;
    /** App 在需将当前章滚入视口/居中时置为 true（一拍后清除） */
    shouldCenterChapterList?: boolean;
    /** App 在需将文件列表滚到当前文件并居中时置为 true（一拍后清除） */
    shouldCenterFileList?: boolean;
    /** App 在需将书签列表滚到当前书签并居中时置为 true（一拍后清除） */
    shouldCenterBookmarkList?: boolean;
    fileCategory: string;
    fileSort: FileSortMode;
    fileCategoryCatalog: FileCategoryDefinition[];
  }>(),
  {
    panelExpanded: true,
    inFullscreen: false,
    showFullscreenSidebar: undefined,
    chapterListScrollSmooth: false,
    shouldCenterChapterList: false,
    shouldCenterFileList: false,
    shouldCenterBookmarkList: false,
    metaProgressByPathKey: () => new Map(),
    fileMetaRecords: () => [],
    liveReadingProgressPercent: undefined,
    highlightTerms: () => [],
    highlightPreviewBg: "var(--reader-bg, var(--bg))",
    monacoFontFamily: "",
  },
);

const emit = defineEmits<{
  "update:activeTab": [value: "files" | "chapters" | "bookmarks" | "highlights"];
  "update:showChapterCounts": [value: boolean];
  "update:fileCategory": [value: string];
  "update:fileSort": [value: FileSortMode];
  pickDirectory: [];
  importDroppedPaths: [paths: string[]];
  openFile: [item: SidebarFileItem];
  jumpToChapter: [chapter: Chapter];
  jumpToBookmark: [line: number];
  clearFileList: [];
  clearFileListCategory: [categoryFilter: string];
  removeFileList: [filePaths: string[]];
  closeCurrentFile: [];
  clearBookmarks: [];
  removeBookmarks: [lines: number[]];
  editBookmark: [line: number];
  removeBookmark: [line: number];
  persistUi: [];
  applyCategoryCatalog: [
    payload: {
      initial: CategoryEditorRow[];
      draft: CategoryEditorRow[];
      catalog: FileCategoryDefinition[];
    },
  ];
  setFilesCategory: [paths: string[], category: string];
  "update:fullscreenFileListPopoversOpen": [open: boolean];
  "update:fileListEditing": [editing: boolean];
  requestExpandPanel: [];
  requestCollapsePanel: [];
  openColorScheme: [];
  openSettings: [];
  findHighlightTerm: [text: string];
  removeHighlightTerm: [text: string];
  clearHighlights: [];
}>();

const {
  chapterListRef,
  fileListRef,
  fileFilterQuery,
  fileRowsEnriched,
  filesFiltered,
  chaptersVisible,
  bookmarkListRef,
  bookmarksVisible,
  sidebarActiveLineNumber,
  onChapterItemClick,
  scrollFileListToIndex,
} = useReaderSidebarLists(props, (e, chapter) => emit(e, chapter));

const activityBarWidthPx = `${SIDEBAR_ACTIVITY_BAR_WIDTH}px`;

const activePanelTitle = computed(() => {
  switch (props.activeTab) {
    case "files":
      return "文件";
    case "chapters":
      return "章节";
    case "bookmarks":
      return "书签";
    case "highlights":
      return "高亮词";
    default:
      return "";
  }
});

const bookmarkTabIconHtml = computed(() => {
  const hasFile = Boolean(props.currentFilePath);
  const hasBookmarks = props.bookmarks.length > 0;
  if (hasFile && hasBookmarks) return icons.bookmarkActive;
  return icons.bookmark;
});

const highlightTabIconMuted = computed(() => {
  const hasFile = Boolean(props.currentFilePath);
  const hasHighlights = (props.highlightTerms?.length ?? 0) > 0;
  return !(hasFile && hasHighlights);
});

function onActivityTabClick(
  tab: "files" | "chapters" | "bookmarks" | "highlights",
) {
  if (props.panelExpanded && props.activeTab === tab) {
    emit("requestCollapsePanel");
    return;
  }
  emit("update:activeTab", tab);
  if (!props.panelExpanded) emit("requestExpandPanel");
}

function bindChapterListRef(value: any) {
  chapterListRef.value = value;
}
function bindFileListRef(value: any) {
  fileListRef.value = value;
}
function bindBookmarkListRef(value: any) {
  bookmarkListRef.value = value;
}

const sidebarDragOverlayVisible = ref(false);

function onSidebarDragEnter(ev: DragEvent) {
  const dt = ev.dataTransfer;
  if (!dataTransferLikelyHasExternalFiles(dt)) return;
  ev.preventDefault();
  sidebarDragOverlayVisible.value = true;
}

function onSidebarDragOver(ev: DragEvent) {
  const dt = ev.dataTransfer;
  if (!dataTransferLikelyHasExternalFiles(dt)) return;
  ev.preventDefault();
  sidebarDragOverlayVisible.value = true;
  try {
    if (dt) dt.dropEffect = "copy";
  } catch {
    /* ignore */
  }
}

function onSidebarDragLeave(ev: DragEvent) {
  const root = ev.currentTarget;
  if (!(root instanceof HTMLElement)) return;
  const related = ev.relatedTarget;
  if (related instanceof Node && root.contains(related)) return;
  sidebarDragOverlayVisible.value = false;
}

function onSidebarDrop(ev: DragEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  sidebarDragOverlayVisible.value = false;
  const paths = collectFsPathsFromDataTransfer(ev.dataTransfer);
  if (paths.length === 0) return;
  emit("importDroppedPaths", paths);
}

defineExpose({
  scrollFileListToIndex,
});
</script>

<template>
  <aside
    class="sidebar"
    data-drop-zone="reader-sidebar"
    @dragenter="onSidebarDragEnter"
    @dragover="onSidebarDragOver"
    @dragleave="onSidebarDragLeave"
    @drop="onSidebarDrop"
  >
    <nav
      class="activityBar"
      :style="{ width: activityBarWidthPx, flexBasis: activityBarWidthPx }"
      aria-label="侧栏视图切换"
    >
      <div class="activityPrimaryTabs">
      <button
        type="button"
        class="activityTabBtn"
        :class="{ active: panelExpanded && activeTab === 'files' }"
        title="文件"
        aria-label="文件"
        @click="onActivityTabClick('files')"
      >
        <span class="activityIcon" v-html="icons.ebook"></span>
      </button>
      <button
        type="button"
        class="activityTabBtn"
        :class="{ active: panelExpanded && activeTab === 'chapters' }"
        title="章节"
        aria-label="章节"
        @click="onActivityTabClick('chapters')"
      >
        <span class="activityIcon" v-html="icons.chapterList"></span>
      </button>
      <button
        type="button"
        class="activityTabBtn"
        :class="{ active: panelExpanded && activeTab === 'bookmarks' }"
        title="书签"
        aria-label="书签"
        @click="onActivityTabClick('bookmarks')"
      >
        <span class="activityIcon" v-html="bookmarkTabIconHtml"></span>
      </button>
      <button
        type="button"
        class="activityTabBtn color"
        :class="{
          active: panelExpanded && activeTab === 'highlights',
          'activityTabBtn--mutedColor': highlightTabIconMuted,
        }"
        title="高亮词"
        aria-label="高亮词"
        @click="onActivityTabClick('highlights')"
      >
        <span class="activityIcon" v-html="icons.highlightMark"></span>
      </button>
      </div>
      <div class="activitySecondaryTabs">
        <button
          type="button"
          class="activityTabBtn color"
          title="配色"
          aria-label="配色"
          @click="emit('openColorScheme')"
        >
          <span class="activityIcon" v-html="icons.palette"></span>
        </button>
        <button
          type="button"
          class="activityTabBtn"
          title="设置"
          aria-label="设置"
          @click="emit('openSettings')"
        >
          <span class="activityIcon" v-html="icons.setting"></span>
        </button>
      </div>
    </nav>
    <div v-show="panelExpanded" class="sidebarPanelColumn">
      <div class="sidebarHeader">
        <span class="sidebarHeaderTitle">{{ activePanelTitle }}</span>
        <button
          v-if="activeTab === 'files'"
          class="btn"
          @click="emit('pickDirectory')"
        >
          选择目录
        </button>
        <div v-else-if="activeTab === 'chapters'" class="sidebarCountToggle">
          <span class="sidebarCountToggleLabel">字数</span>
          <SwitchToggle
            size="sm"
            :model-value="showChapterCounts"
            aria-label="章节列表显示字数"
            @update:model-value="emit('update:showChapterCounts', $event)"
          />
        </div>
        <div v-else></div>
      </div>
      <ChapterListPanel
        v-show="activeTab === 'chapters'"
        :current-file-path="currentFilePath"
        :chapters-visible="chaptersVisible"
        :sidebar-active-line-number="sidebarActiveLineNumber"
        :show-chapter-counts="showChapterCounts"
        :format-char-count="formatCharCount"
        @jump-to-chapter="onChapterItemClick"
        @close-current-file="emit('closeCurrentFile')"
        @bind-list-ref="bindChapterListRef"
      />
      <FileListPanel
        v-show="activeTab === 'files'"
        :show-fullscreen-sidebar="showFullscreenSidebar"
        :files="fileRowsEnriched"
        :files-filtered="filesFiltered"
        :file-filter-query="fileFilterQuery"
        :current-file-path="currentFilePath"
        :meta-progress-map="metaProgressByPathKey"
        :live-reading-progress-percent="liveReadingProgressPercent"
        :file-category="fileCategory"
        :file-sort="fileSort"
        :file-category-catalog="fileCategoryCatalog"
        @update-file-filter-query="fileFilterQuery = $event"
        @update:file-category="emit('update:fileCategory', $event)"
        @update:file-sort="emit('update:fileSort', $event)"
        @persist-ui="emit('persistUi')"
        @apply-category-catalog="emit('applyCategoryCatalog', $event)"
        @set-files-category="
          (paths, category) => emit('setFilesCategory', paths, category)
        "
        @open-file="(item: SidebarFileItem) => emit('openFile', item)"
        @clear-file-list="emit('clearFileList')"
        @clear-file-list-category="emit('clearFileListCategory', $event)"
        @remove-file-list="emit('removeFileList', $event)"
        @import-dropped-paths="emit('importDroppedPaths', $event)"
        @bind-list-ref="bindFileListRef"
        @update:fullscreen-file-list-popovers-open="
          emit('update:fullscreenFileListPopoversOpen', $event)
        "
        @update:file-list-editing="emit('update:fileListEditing', $event)"
      />
      <BookmarkListPanel
        v-show="activeTab === 'bookmarks'"
        :current-file-path="currentFilePath"
        :bookmarks="bookmarksVisible"
        :active-bookmark-line="activeBookmarkLine ?? null"
        @jump-to-bookmark="emit('jumpToBookmark', $event)"
        @clear-bookmarks="emit('clearBookmarks')"
        @edit-bookmark="emit('editBookmark', $event)"
        @remove-bookmark="emit('removeBookmark', $event)"
        @bind-list-ref="bindBookmarkListRef"
      />
      <HighlightListPanel
        v-show="activeTab === 'highlights'"
        :highlight-terms="highlightTerms"
        :highlight-preview-bg="highlightPreviewBg"
        :monaco-font-family="monacoFontFamily"
        @find-highlight-term="emit('findHighlightTerm', $event)"
        @remove-highlight-term="emit('removeHighlightTerm', $event)"
        @clear-highlights="emit('clearHighlights')"
      />
    </div>
    <Transition name="sidebarDropOverlay">
      <div
        v-if="sidebarDragOverlayVisible"
        class="sidebarDropOverlay"
        aria-hidden="true"
      >
        <p class="sidebarDropOverlayText">添加文件</p>
      </div>
    </Transition>
  </aside>
</template>

<style scoped>
.sidebar {
  position: relative;
  background: var(--panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  height: 100%;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

.sidebarDropOverlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  background: rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.sidebarDropOverlayText {
  margin: 0;
  max-width: 100%;
  z-index: 10000;
  padding: 6px 10px;
  border-radius: 4px;
  background-color: var(--bg);
  color: var(--fg);
  font-size: 12px;
  text-align: center;
}

.sidebarDropOverlay-enter-active,
.sidebarDropOverlay-leave-active {
  transition: opacity 0.15s ease;
}

.sidebarDropOverlay-enter-from,
.sidebarDropOverlay-leave-to {
  opacity: 0;
}

.activityBar {
  flex: 0 0 auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--bg);
  border-right: 1px solid var(--border);
}

.activityPrimaryTabs {
  display: flex;
  flex-direction: column;
}

.activitySecondaryTabs {
  margin-top: auto;
  display: flex;
  flex-direction: column;
}

.activityTabBtn {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  margin: 0;
  border: none;
  border-left: 2px solid transparent;
  border-right: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  color: var(--tab-fg);
}

.activityTabBtn:not(.color) :deep(svg) path {
  fill: currentColor;
}
.activityTabBtn.color {
  opacity: 0.6;
}
.activityTabBtn.color:hover {
  opacity: 1;
}
.activityTabBtn--mutedColor .activityIcon :deep(svg) {
  filter: grayscale(1) brightness(1.2);
}

.activityTabBtn:hover {
  color: var(--tab-fg-hover);
  /* background: var(--icon-btn-bg-hover); */
}

.activityTabBtn.active {
  color: var(--tab-fg-active);
  border-left-color: var(--tab-underline);
  /* background: transparent; */
}

.activityIcon {
  line-height: 0;
  display: block;
}

.activityIcon :deep(svg) {
  width: 22px;
  height: 22px;
  display: block;
}

.sidebarPanelColumn {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
}

.sidebarHeader {
  flex: 0 0 auto;
  background: var(--bg);
  padding: 8px 10px;
  font-size: 12px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 44px;
}

.sidebarHeaderTitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--tab-fg-active);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sidebarCountToggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sidebarCountToggleLabel {
  font-size: 12px;
  color: var(--tab-fg);
  white-space: nowrap;
}
</style>
