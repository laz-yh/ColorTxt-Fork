<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
  type ComponentPublicInstance,
} from "vue";
import AppContextMenu from "./AppContextMenu.vue";
import AppCustomSelect from "./AppCustomSelect.vue";
import CategoryPickerMenu from "./CategoryPickerMenu.vue";
import FileCategoryManageModal from "./FileCategoryManageModal.vue";
import VirtualList from "./VirtualList.vue";
import {
  READER_SIDEBAR_ROW_STRIDE,
  type SidebarFileItem,
} from "../composables/useReaderSidebarLists";
import { useFileListCategorySort } from "../composables/useFileListCategorySort";
import { useFileListMenus } from "../composables/useFileListMenus";
import { useFileListSelection } from "../composables/useFileListSelection";
import type { FileCategoryDefinition } from "../constants/fileCategories";
import type { FileSortMode } from "../constants/fileCategories";
import {
  FILE_CATEGORY_FILTER_ALL,
  normalizeCategoryFilter,
} from "../constants/fileCategories";
import type { CategoryEditorRow } from "../constants/fileCategories";
import {
  borderColorForFile,
  fileItemShowCategoryMark,
  fileRowProgressForPath,
  formatFileReadProgress,
  formatFileSize,
  isProgressComplete,
} from "../utils/fileListPanelDisplay";
import { icons } from "../icons";
import { fileListEmptyHint, fileListDropHint, fileListNoMatchHint } from "../constants/appUi";
const props = withDefaults(
  defineProps<{
    files: SidebarFileItem[];
    filesFiltered: SidebarFileItem[];
    currentFilePath: string | null;
    fileFilterQuery: string;
    metaProgressMap?: Map<string, number>;
    liveReadingProgressPercent?: number;
    fileCategory: string;
    fileSort: FileSortMode;
    fileCategoryCatalog: FileCategoryDefinition[];
    /** 全屏浮动侧栏是否展开；从展开变为收起时关闭 Teleport 到 body 的浮层 */
    showFullscreenSidebar?: boolean;
  }>(),
  {
    metaProgressMap: () => new Map<string, number>(),
    liveReadingProgressPercent: undefined,
  },
);

const emit = defineEmits<{
  /** 全屏侧栏：文件列表 Teleport 弹层是否打开（供收起侧栏逻辑） */
  "update:fullscreenFileListPopoversOpen": [open: boolean];
  updateFileFilterQuery: [value: string];
  "update:fileCategory": [value: string];
  "update:fileSort": [value: FileSortMode];
  persistUi: [];
  applyCategoryCatalog: [
    payload: {
      initial: CategoryEditorRow[];
      draft: CategoryEditorRow[];
      catalog: FileCategoryDefinition[];
    },
  ];
  setFilesCategory: [paths: string[], category: string];
  openFile: [item: SidebarFileItem];
  importDroppedPaths: [paths: string[]];
  clearFileList: [];
  clearFileListCategory: [categoryFilter: string];
  removeFileList: [filePaths: string[]];
  bindListRef: [value: InstanceType<typeof VirtualList> | null];
  "update:fileListEditing": [editing: boolean];
}>();

function fileRowProgress(filePath: string): number | undefined {
  return fileRowProgressForPath(
    props.currentFilePath,
    props.liveReadingProgressPercent,
    props.metaProgressMap,
    filePath,
  );
}

function borderColorForFileRow(f: SidebarFileItem): string {
  return borderColorForFile(f, props.fileCategoryCatalog);
}

function fileItemShowCategoryMarkRow(f: SidebarFileItem): boolean {
  return fileItemShowCategoryMark(f, props.fileCategory);
}

function onBindListRef(value: Element | ComponentPublicInstance | null) {
  if (value && typeof value === "object" && "$el" in value) {
    emit("bindListRef", value as InstanceType<typeof VirtualList>);
    return;
  }
  emit("bindListRef", null);
}

const filterVisible = ref(false);
const fileFilterInputRef = ref<HTMLInputElement | null>(null);

watch(filterVisible, async (visible) => {
  if (visible) {
    await nextTick();
    fileFilterInputRef.value?.focus({ preventScroll: true });
    return;
  }
  emit("updateFileFilterQuery", "");
});

const {
  manageModalOpen,
  categoryMenuCounts,
  categoryFixedTop,
  categoryScrollItems,
  categoryFixedBottom,
  categoryTriggerLabel,
  categoryTriggerSuffix,
  categoryTriggerMarkColor,
  sortScrollItems,
  sortDisplayLabel,
  sortTriggerPrefixHtml,
  onCategorySelect,
  onCategoryAction,
  onSortSelect,
} = useFileListCategorySort(props, emit);

const isFileCategoryFilterAll = computed(
  () => normalizeCategoryFilter(props.fileCategory) === FILE_CATEGORY_FILTER_ALL,
);

const clearFileListFooterDisabled = computed(() => {
  if (props.fileFilterQuery.trim()) return true;
  if (!isFileCategoryFilterAll.value && props.filesFiltered.length === 0) {
    return true;
  }
  return false;
});

function onClearFileListFooterClick() {
  if (isFileCategoryFilterAll.value) {
    emit("clearFileList");
    return;
  }
  emit("clearFileListCategory", props.fileCategory);
}

const listFocusEl = useTemplateRef<HTMLElement>("listFocusEl");
const footerCategoryBtnRef = useTemplateRef<HTMLButtonElement>(
  "footerCategoryBtnRef",
);

const selection = useFileListSelection(props, emit, {
  listFocusEl,
  footerCategoryBtnRef,
});

const {
  isEditingFileList,
  selectedFilePaths,
  lastSelectedFilePath,
  onFileItemClick,
  onListKeydown,
  enterEditFileListMode,
  onRemoveSelectedFileListItems,
} = selection;

watch(
  isEditingFileList,
  (v) => emit("update:fileListEditing", v),
  { immediate: true },
);

const menus = reactive(
  useFileListMenus(emit, {
    isEditingFileList: selection.isEditingFileList,
    selectedFilePaths: selection.selectedFilePaths,
    lastSelectedFilePath: selection.lastSelectedFilePath,
    footerCategoryBtnRef: selection.footerCategoryBtnRef,
    clearEditSelectionState: selection.clearEditSelectionState,
    onRemoveSelectedFileListItems: selection.onRemoveSelectedFileListItems,
    selectAllVisible: selection.selectAllVisible,
    invertSelectionVisible: selection.invertSelectionVisible,
    selectSinglePathForContextMenu: selection.selectSinglePathForContextMenu,
  }),
);

const categoryToolbarSelectRef = ref<InstanceType<typeof AppCustomSelect> | null>(
  null,
);
const sortToolbarSelectRef = ref<InstanceType<typeof AppCustomSelect> | null>(
  null,
);

const categorySelectPanelOpen = ref(false);
const sortSelectPanelOpen = ref(false);

const fullscreenFileListPopoversOpenComputed = computed(
  () =>
    Boolean(
      menus.fileContextMenuOpen ||
        menus.editContextMenuOpen ||
        menus.categoryPickerOpen ||
        manageModalOpen.value ||
        categorySelectPanelOpen.value ||
        sortSelectPanelOpen.value,
    ),
);

watch(
  fullscreenFileListPopoversOpenComputed,
  (v) => emit("update:fullscreenFileListPopoversOpen", v),
  { immediate: true },
);

function dismissAllFullscreenTeleportUi() {
  menus.dismissAllTeleportMenus();
  filterVisible.value = false;
  manageModalOpen.value = false;
  categoryToolbarSelectRef.value?.closePanel?.();
  sortToolbarSelectRef.value?.closePanel?.();
}

watch(
  () => props.showFullscreenSidebar,
  (vis, prev) => {
    if (prev !== true) return;
    if (vis === true) return;
    dismissAllFullscreenTeleportUi();
  },
);

const editCtxMenuPanelRef = useTemplateRef<HTMLElement>("editCtxMenuPanelRef");
const editCtxCategoryFlyoutRef = useTemplateRef<HTMLElement>(
  "editCtxCategoryFlyoutRef",
);
const editCtxMenuLeft = ref(0);
const editCtxMenuTop = ref(0);
/** 子菜单在右侧放不下时改为向左展开（appShellMenuFlyout--left） */
const editCtxFlyoutUseLeft = ref(false);
/** 子菜单在视口内做最后平移修正（翻转后仍可能上下溢出） */
const editCtxFlyoutTransform = ref("");
/** 子菜单完成左右翻转与 translate 夹紧后再显示，避免首帧错位闪烁 */
const editCtxFlyoutPositionReady = ref(false);

const editCtxFlyoutPanelStyle = computed(() => {
  const s: Record<string, string> = {};
  if (editCtxFlyoutTransform.value) {
    s.transform = editCtxFlyoutTransform.value;
  }
  if (menus.editCategorySubOpen) {
    s.visibility = editCtxFlyoutPositionReady.value ? "visible" : "hidden";
    s.pointerEvents = editCtxFlyoutPositionReady.value ? "auto" : "none";
  }
  return s;
});

function clampEditContextMenuToViewport() {
  if (!menus.editContextMenuOpen) return;
  const el = editCtxMenuPanelRef.value;
  if (!el) return;
  const margin = 8;
  const rawX = menus.editContextMenuX;
  const rawY = menus.editContextMenuY;
  const maxX = Math.max(margin, window.innerWidth - el.offsetWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - el.offsetHeight - margin);
  editCtxMenuLeft.value = Math.min(Math.max(margin, rawX), maxX);
  editCtxMenuTop.value = Math.min(Math.max(margin, rawY), maxY);
}

function resetEditCategoryFlyoutClamp() {
  editCtxFlyoutUseLeft.value = false;
  editCtxFlyoutTransform.value = "";
  editCtxFlyoutPositionReady.value = false;
}

function applyEditCategoryFlyoutTranslateClamp() {
  const flyout = editCtxCategoryFlyoutRef.value;
  if (!flyout || !menus.editCategorySubOpen) return;
  const margin = 8;
  const r = flyout.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (r.bottom > window.innerHeight - margin) {
    dy = window.innerHeight - margin - r.bottom;
  }
  if (r.top + dy < margin) {
    dy = margin - r.top;
  }
  if (r.right + dx > window.innerWidth - margin) {
    dx = window.innerWidth - margin - r.right;
  }
  if (r.left + dx < margin) {
    dx = margin - r.left;
  }
  editCtxFlyoutTransform.value =
    dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : "";
}

async function layoutEditCategoryFlyoutInViewport(opts?: {
  instant?: boolean;
}) {
  if (!menus.editContextMenuOpen || !menus.editCategorySubOpen) {
    resetEditCategoryFlyoutClamp();
    return;
  }
  if (!opts?.instant) {
    editCtxFlyoutPositionReady.value = false;
  }
  editCtxFlyoutUseLeft.value = false;
  editCtxFlyoutTransform.value = "";
  await nextTick();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  const flyout = editCtxCategoryFlyoutRef.value;
  if (!flyout || !menus.editCategorySubOpen) {
    editCtxFlyoutPositionReady.value = true;
    return;
  }
  const margin = 8;
  let r = flyout.getBoundingClientRect();
  if (r.right > window.innerWidth - margin) {
    editCtxFlyoutUseLeft.value = true;
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  }
  applyEditCategoryFlyoutTranslateClamp();
  editCtxFlyoutPositionReady.value = true;
}

async function layoutEditContextMenuPanel() {
  if (!menus.editContextMenuOpen) return;
  editCtxMenuLeft.value = menus.editContextMenuX;
  editCtxMenuTop.value = menus.editContextMenuY;
  if (!menus.editCategorySubOpen) {
    resetEditCategoryFlyoutClamp();
  }
  await nextTick();
  requestAnimationFrame(() => {
    clampEditContextMenuToViewport();
    if (menus.editCategorySubOpen) {
      void layoutEditCategoryFlyoutInViewport();
    }
  });
}

watch(
  () =>
    [
      menus.editContextMenuOpen,
      menus.editContextMenuX,
      menus.editContextMenuY,
      menus.editCategorySubOpen,
    ] as const,
  async ([open]) => {
    if (!open) {
      resetEditCategoryFlyoutClamp();
      return;
    }
    await layoutEditContextMenuPanel();
  },
);

function onWindowResizeForEditCtxMenu() {
  if (!menus.editContextMenuOpen) return;
  clampEditContextMenuToViewport();
  if (menus.editCategorySubOpen) {
    void layoutEditCategoryFlyoutInViewport({ instant: true });
  }
}

onMounted(() => {
  window.addEventListener("resize", onWindowResizeForEditCtxMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResizeForEditCtxMenu);
});

</script>

<template>
  <div class="sidebarListWrap">
    <div
      ref="listFocusEl"
      class="sidebarTabBody"
      :tabindex="isEditingFileList ? 0 : -1"
      @keydown="onListKeydown"
    >
      <div
        class="fileToolbarRow"
        :class="{ 'fileToolbarRow--filterOpen': filterVisible }"
      >
        <AppCustomSelect
          ref="categoryToolbarSelectRef"
          class="fileToolbarSelect"
          :model-value="fileCategory"
          :display-label="categoryTriggerLabel"
          :display-suffix="categoryTriggerSuffix"
          :trigger-mark-color="categoryTriggerMarkColor"
          :fixed-top-items="categoryFixedTop"
          :scroll-items="categoryScrollItems"
          :fixed-bottom-items="categoryFixedBottom"
          :scroll-max-height="300"
          ariaLabel="文件分类"
          category-color-marks
          @update:model-value="onCategorySelect"
          @action="onCategoryAction"
          @panel-open-change="categorySelectPanelOpen = $event"
        />
        <AppCustomSelect
          ref="sortToolbarSelectRef"
          class="fileToolbarSelect"
          :model-value="fileSort"
          :display-label="sortDisplayLabel"
          :trigger-prefix-html="sortTriggerPrefixHtml"
          :fixed-top-items="[]"
          :scroll-items="sortScrollItems"
          :fixed-bottom-items="[]"
          :scroll-max-height="430"
          ariaLabel="文件排序"
          @update:model-value="onSortSelect"
          @panel-open-change="sortSelectPanelOpen = $event"
        />
        <button
          type="button"
          class="btn btnIconSquare fileSearchToggle"
          :class="{ active: filterVisible }"
          aria-label="切换过滤文件名"
          :title="filterVisible ? '隐藏过滤' : '显示过滤'"
          @click="filterVisible = !filterVisible"
        >
          <span class="fileSearchToggleIcon" v-html="icons.find" />
        </button>
      </div>
      <div v-show="filterVisible" class="fileFilterRow">
        <input
          ref="fileFilterInputRef"
          :value="fileFilterQuery"
          class="fileFilterInput"
          type="search"
          spellcheck="false"
          autocomplete="off"
          placeholder="过滤文件名…"
          aria-label="过滤文件列表"
          @input="
            emit(
              'updateFileFilterQuery',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </div>
      <div v-if="files.length === 0" class="empty">
        <div>{{ fileListEmptyHint }}</div>
        <p>{{ fileListDropHint }}</p>
      </div>
      <template v-else>
        <div v-if="filesFiltered.length === 0" class="empty">
          {{ fileListNoMatchHint }}
        </div>
        <div v-else class="sidebarListViewportPad">
          <VirtualList
            :ref="onBindListRef"
            class="sidebarList sidebarList--itemGap"
            :item-count="filesFiltered.length"
            :row-stride="READER_SIDEBAR_ROW_STRIDE"
            :overscan="10"
            :item-key="(i) => filesFiltered[i]?.path ?? i"
          >
            <template #default="{ index }">
              <button
                class="sidebarItem fileItem"
                :class="{
                  active: filesFiltered[index].path === currentFilePath,
                  'fileItem--last-selected':
                    isEditingFileList &&
                    lastSelectedFilePath === filesFiltered[index].path,
                }"
                :title="filesFiltered[index].path"
                @click="onFileItemClick(filesFiltered[index], index, $event)"
                @contextmenu="
                  menus.onFileItemContextMenu(filesFiltered[index].path, $event)
                "
              >
                <span
                  v-if="fileItemShowCategoryMarkRow(filesFiltered[index])"
                  class="fileItemCatMark"
                  aria-hidden="true"
                  :style="{
                    backgroundColor: borderColorForFileRow(
                      filesFiltered[index],
                    ),
                  }"
                />
                <span class="fileItemMain">
                  <input
                    v-if="isEditingFileList"
                    class="fileItemCheckbox"
                    type="checkbox"
                    :checked="
                      selectedFilePaths.includes(filesFiltered[index].path)
                    "
                    tabindex="-1"
                    aria-hidden="true"
                  />
                  <span class="itemName">{{ filesFiltered[index].name }}</span>
                  <span
                    v-if="
                      typeof fileRowProgress(filesFiltered[index].path) ===
                      'number'
                    "
                    class="itemMeta itemMeta--progress"
                    :class="{
                      'itemMeta--progress-complete': isProgressComplete(
                        fileRowProgress(filesFiltered[index].path),
                      ),
                    }"
                  >
                    {{
                      formatFileReadProgress(
                        fileRowProgress(filesFiltered[index].path) as number,
                      )
                    }}
                  </span>
                  <span class="itemMeta">{{
                    formatFileSize(filesFiltered[index].size)
                  }}</span>
                </span>
              </button>
            </template>
          </VirtualList>
        </div>
      </template>
    </div>
    <div v-if="files.length > 0" class="sidebarTabFooter">
      <span v-if="isEditingFileList" class="sidebarTabFooterStat">
        已选中 {{ selectedFilePaths.length }} 个文件
      </span>
      <span v-else class="sidebarTabFooterStat"
        >共 {{ filesFiltered.length }} 个文件</span
      >
      <button
        v-if="!isEditingFileList"
        type="button"
        class="link sidebarTabFooterAction"
        :disabled="filesFiltered.length === 0"
        @click="enterEditFileListMode"
      >
        编辑
      </button>
      <button
        v-if="!isEditingFileList"
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        :disabled="clearFileListFooterDisabled"
        @click="onClearFileListFooterClick"
      >
        {{ isFileCategoryFilterAll ? "清空" : "清空分类" }}
      </button>
      <template v-if="isEditingFileList">
        <button
          ref="footerCategoryBtnRef"
          type="button"
          class="link sidebarTabFooterAction"
          :disabled="selectedFilePaths.length === 0"
          @click="menus.onFooterCategoryClick"
        >
          分类
        </button>
        <button
          type="button"
          class="link danger sidebarTabFooterAction"
          :disabled="selectedFilePaths.length === 0"
          @click="onRemoveSelectedFileListItems"
        >
          移除
        </button>
        <button
          type="button"
          class="link sidebarTabFooterAction"
          @click="menus.exitEditFileListMode"
        >
          退出编辑
        </button>
      </template>
    </div>
    <AppContextMenu
      :open="menus.fileContextMenuOpen"
      :x="menus.fileContextMenuX"
      :y="menus.fileContextMenuY"
      :items="menus.fileContextMenuItems"
      :min-width="160"
      @close="menus.closeFileContextMenu"
      @select="menus.onFileContextMenuSelect"
    />
    <Teleport to="body">
      <div
        v-if="menus.editContextMenuOpen"
        ref="editCtxMenuPanelRef"
        data-fullscreen-sidebar-float
        class="editCtxMenu appShellMenuPanel"
        :style="{
          left: `${editCtxMenuLeft}px`,
          top: `${editCtxMenuTop}px`,
        }"
        role="menu"
        @click.stop
      >
        <div
          class="appShellMenuSubWrap"
          @mouseenter="menus.setEditCategorySubOpen(true)"
          @mouseleave="menus.setEditCategorySubOpen(false)"
        >
          <button
            type="button"
            class="appShellMenuItem"
            role="menuitem"
            aria-haspopup="menu"
            :aria-expanded="menus.editCategorySubOpen"
          >
            <span class="appShellMenuLabel">分类</span>
            <span class="appShellMenuSubChevron">›</span>
          </button>
          <div
            v-show="menus.editCategorySubOpen"
            ref="editCtxCategoryFlyoutRef"
            class="appShellMenuFlyout editCtxCategoryFlyout"
            :class="
              editCtxFlyoutUseLeft
                ? 'appShellMenuFlyout--left'
                : 'appShellMenuFlyout--right'
            "
            :style="editCtxFlyoutPanelStyle"
            role="menu"
            @click.stop
          >
            <div class="appShellMenuFlyoutList">
              <button
                type="button"
                class="appShellMenuFlyoutItem"
                role="menuitem"
                @click="menus.onEditMenuCategoryPicked('')"
              >
                <span class="appShellMenuItemRowBody">
                  <span class="appShellMenuItemLabelWithCount">
                    <span class="appShellMenuItemLabelText">未分类</span>
                    <span class="appShellMenuItemSuffix"
                      >({{ categoryMenuCounts.uncategorized }})</span
                    >
                  </span>
                </span>
              </button>
              <div class="appShellMenuFlyoutDivider" role="separator" />
              <button
                v-for="(c, i) in fileCategoryCatalog"
                :key="i"
                type="button"
                class="appShellMenuFlyoutItem"
                role="menuitem"
                @click="menus.onEditMenuCategoryPicked(c.name)"
              >
                <span
                  class="appShellMenuItemMark"
                  aria-hidden="true"
                  :style="{ backgroundColor: c.color }"
                />
                <span class="appShellMenuItemRowBody">
                  <span class="appShellMenuItemLabelWithCount">
                    <span class="appShellMenuItemLabelText">{{ c.name }}</span>
                    <span class="appShellMenuItemSuffix"
                      >({{ categoryMenuCounts.byName[c.name] ?? 0 }})</span
                    >
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="appShellMenuItem appShellMenuItem--danger"
          role="menuitem"
          @click="menus.onEditMenuRemove"
        >
          移除
        </button>
        <div class="appShellMenuDivider" role="separator" />
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="menus.onEditMenuSelectAll"
        >
          全选
        </button>
        <button
          type="button"
          class="appShellMenuItem"
          role="menuitem"
          @click="menus.onEditMenuInvert"
        >
          反选
        </button>
      </div>
    </Teleport>
    <Teleport to="body">
      <div
        v-if="menus.editContextMenuOpen"
        data-fullscreen-sidebar-float
        class="editCtxMenuBackdrop"
        @pointerdown="menus.closeEditContextMenu"
      />
    </Teleport>
    <CategoryPickerMenu
      :open="menus.categoryPickerOpen"
      :x="menus.categoryPickX"
      :y="menus.categoryPickY"
      :align-above="menus.categoryPickFromFooter"
      :catalog="fileCategoryCatalog"
      :menu-counts="categoryMenuCounts"
      :min-width="140"
      @close="menus.closeCategoryPicker"
      @pick="menus.onCategoryPicked"
    />
    <FileCategoryManageModal
      v-model="manageModalOpen"
      :catalog="fileCategoryCatalog"
      @apply="emit('applyCategoryCatalog', $event)"
    />
  </div>
</template>

<style scoped>
.sidebarListWrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sidebarTabBody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}
.fileToolbarRow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.fileToolbarRow--filterOpen {
  border-bottom: none;
}
.fileToolbarSelect {
  flex: 1;
  min-width: 0;
}
.fileSearchToggle {
  flex-shrink: 0;
}
.fileSearchToggleIcon {
  display: flex;
  width: 16px;
  height: 16px;
}
.fileSearchToggleIcon :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}
.fileFilterRow {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 8px 6px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}
.fileFilterInput {
  box-sizing: border-box;
  width: 100%;
}
.sidebarListViewportPad {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  /* 列表与边缘留白由 .sidebar .virtualList-scroll.sidebarList 的 padding 统一控制 */
  padding: 0;
  background: var(--bg);
}
.sidebarList {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.sidebarList--itemGap :deep(.virtualList-row) {
  padding-bottom: 5px;
}
.sidebarItem {
  text-align: left;
  background: transparent;
  border: none;
  color: var(--list-item-fg);
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  gap: 8px;
  align-items: center;
}
.itemName {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.itemMeta {
  font-size: 12px;
  color: inherit;
  opacity: 0.65;
  white-space: nowrap;
}
.itemMeta--progress {
  color: var(--warning);
  opacity: 1;
}

.itemMeta--progress-complete {
  color: var(--success);
}
.sidebarItem:hover {
  color: var(--list-item-fg);
  background: var(--list-item-bg-hover);
}
.sidebarItem.active {
  color: var(--list-item-fg-active);
  background: var(--list-item-bg-active);
}
.empty {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px 16px;
  font-size: 12px;
  color: var(--secondary);
}
.fileItem {
  align-items: stretch;
  gap: 6px;
  padding-left: 6px;
}
.fileItemCatMark {
  flex-shrink: 0;
  width: 3px;
  align-self: stretch;
  border-radius: 2px;
  margin: 4px 0 2px 0;
}
.fileItemMain {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: center;
}
.fileItem--last-selected {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.fileItemCheckbox {
  pointer-events: none;
  margin: 0;
  width: 14px;
  height: 14px;
}
.sidebarTabFooter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--muted);
  border-top: 1px solid var(--border);
  background: var(--bg);
  user-select: none;
}
.sidebarTabFooterStat {
  flex: 1;
  min-width: 0;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebarTabFooterAction {
  flex-shrink: 0;
}
.editCtxMenuBackdrop {
  position: fixed;
  inset: 0;
  z-index: 6990;
}
.editCtxMenu {
  position: fixed;
  z-index: 7100;
  min-width: 100px;
}
.editCtxCategoryFlyout {
  min-width: 140px;
}
</style>
