<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  useTemplateRef,
} from "vue";

export type CustomSelectItem =
  | {
      kind: "item";
      id: string;
      label: string;
      /** 左侧 3px 色块颜色（分类下拉等） */
      borderColor?: string;
      /** 标签前内联 SVG 等（本地可信 HTML） */
      prefixHtml?: string;
      disabled?: boolean;
      danger?: boolean;
      /** 为 true 时点击只触发 `action`，不更新 modelValue */
      actionOnly?: boolean;
      /** 分类色块模式下不显示左侧色块（如「全部」「未分类」） */
      skipCategoryMark?: boolean;
      /** 主标签后的附加文案（如「(12)」、说明等），样式见 .appShellMenuItemSuffix */
      labelSuffix?: string;
    }
  | { kind: "divider" };

const props = withDefaults(
  defineProps<{
    /** 当前选中项 id */
    modelValue: string;
    /** 触发器上展示文案 */
    displayLabel: string;
    /** 触发器主标签后的附加文案（数量、说明等），样式同 .appShellMenuItemSuffix */
    displaySuffix?: string;
    /**
     * 触发器主文案前的颜色方块（如当前为具体分类时传入 catalog 颜色）；
     * 与 triggerPrefixHtml 可同时存在，顺序为：色块 → 前缀图标 → 文案。
     */
    triggerMarkColor?: string;
    /** 触发器标签前的 HTML（如排序方向图标） */
    triggerPrefixHtml?: string;
    /** 顶部固定区 */
    fixedTopItems: readonly CustomSelectItem[];
    /** 中间可滚动区 */
    scrollItems: readonly CustomSelectItem[];
    /** 底部固定区 */
    fixedBottomItems: readonly CustomSelectItem[];
    ariaLabel: string;
    /** 中间区域最大高度（px） */
    scrollMaxHeight?: number;
    /** 下拉最小宽度（px），默认与触发器同宽 */
    minPanelWidth?: number;
    /** 为 true 时用左侧 3px 色块表示分类色（排序项带 prefixHtml 时不显示色块） */
    categoryColorMarks?: boolean;
  }>(),
  {
    scrollMaxHeight: 220,
    minPanelWidth: 0,
    triggerPrefixHtml: "",
    categoryColorMarks: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [id: string];
  /** 特殊项（如「分类管理」）不更新 modelValue 时发出 */
  action: [id: string];
  /** 下拉 Teleport 面板展开状态，供全屏侧栏收起逻辑等使用 */
  "panel-open-change": [open: boolean];
}>();

const open = ref(false);
const triggerRef = useTemplateRef<HTMLButtonElement>("triggerRef");
const panelRef = useTemplateRef<HTMLElement>("panelRef");
const scrollAreaRef = useTemplateRef<HTMLElement>("scrollAreaRef");
/** 仅在实际出现纵向滚动条时加右侧内边距 */
const scrollAreaHasScrollbar = ref(false);
let scrollAreaResizeObserver: ResizeObserver | null = null;

function updateScrollAreaScrollbarFlag() {
  const el = scrollAreaRef.value;
  if (!el) {
    scrollAreaHasScrollbar.value = false;
    return;
  }
  scrollAreaHasScrollbar.value = el.scrollHeight - el.clientHeight > 0.5;
}

function bindScrollAreaResizeObserver() {
  unbindScrollAreaResizeObserver();
  const el = scrollAreaRef.value;
  if (!el) return;
  scrollAreaResizeObserver = new ResizeObserver(() => {
    updateScrollAreaScrollbarFlag();
  });
  scrollAreaResizeObserver.observe(el);
}

function unbindScrollAreaResizeObserver() {
  scrollAreaResizeObserver?.disconnect();
  scrollAreaResizeObserver = null;
}
const posLeft = ref(0);
const posTop = ref(0);
const panelWidth = ref(160);

function clampPanel() {
  const panel = panelRef.value;
  if (!panel) return;
  const margin = 8;
  const w = panel.offsetWidth;
  const h = panel.offsetHeight;
  const maxX = Math.max(margin, window.innerWidth - w - margin);
  const maxY = Math.max(margin, window.innerHeight - h - margin);
  posLeft.value = Math.min(Math.max(margin, posLeft.value), maxX);
  posTop.value = Math.min(Math.max(margin, posTop.value), maxY);
}

async function positionPanel() {
  const trig = triggerRef.value;
  if (!trig) return;
  const r = trig.getBoundingClientRect();
  panelWidth.value = Math.max(
    props.minPanelWidth > 0 ? props.minPanelWidth : r.width,
    140,
  );
  posLeft.value = r.left;
  posTop.value = r.bottom + 4;
  await nextTick();
  clampPanel();
}

function toggle() {
  open.value = !open.value;
  if (open.value) void positionPanel();
}

function close() {
  open.value = false;
}

function selectItem(it: Extract<CustomSelectItem, { kind: "item" }>) {
  if (it.actionOnly) {
    emit("action", it.id);
    close();
    return;
  }
  emit("update:modelValue", it.id);
  close();
}

function onDocPointerDown(ev: PointerEvent) {
  if (!open.value) return;
  const t = ev.target as Node | null;
  if (t && panelRef.value?.contains(t)) return;
  if (t && triggerRef.value?.contains(t)) return;
  close();
}

function onKey(ev: KeyboardEvent) {
  if (!open.value) return;
  if (ev.key === "Escape") {
    ev.preventDefault();
    close();
  }
}

watch(open, async (v) => {
  emit("panel-open-change", v);
  if (v) {
    await nextTick();
    await positionPanel();
    await nextTick();
    updateScrollAreaScrollbarFlag();
    bindScrollAreaResizeObserver();
    requestAnimationFrame(() => {
      updateScrollAreaScrollbarFlag();
    });
  } else {
    unbindScrollAreaResizeObserver();
    scrollAreaHasScrollbar.value = false;
  }
}, { immediate: true });

watch(
  () => [props.scrollItems.length, props.scrollMaxHeight] as const,
  async () => {
    if (!open.value) return;
    await nextTick();
    updateScrollAreaScrollbarFlag();
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointerDown);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", close);
});
onBeforeUnmount(() => {
  unbindScrollAreaResizeObserver();
  document.removeEventListener("pointerdown", onDocPointerDown);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", close);
});

defineExpose({
  /** 供父级在全屏侧栏收起等时机强制收合 Teleport 面板 */
  closePanel: close,
});

function itemButtonClass(it: Extract<CustomSelectItem, { kind: "item" }>) {
  const c = ["appShellMenuItem"];
  if (it.danger) c.push("appShellMenuItem--danger");
  if (!it.actionOnly && it.id === props.modelValue) c.push("is-active");
  return c.join(" ");
}

function showItemColorMark(it: Extract<CustomSelectItem, { kind: "item" }>) {
  if (!props.categoryColorMarks) return false;
  if (it.prefixHtml) return false;
  if (it.actionOnly) return false;
  if (it.skipCategoryMark) return false;
  return true;
}

function itemMarkBackground(it: Extract<CustomSelectItem, { kind: "item" }>) {
  const c = it.borderColor?.trim();
  if (c) return c;
  return "var(--border)";
}
</script>

<template>
  <div class="customSelect">
    <button
      ref="triggerRef"
      type="button"
      class="btn customSelectTrigger"
      :aria-expanded="open"
      :aria-haspopup="true"
      :aria-label="ariaLabel"
      @click.stop="toggle"
    >
      <span class="customSelectTriggerStart">
        <span
          v-if="triggerMarkColor"
          class="customSelectTriggerMark"
          aria-hidden="true"
          :style="{ backgroundColor: triggerMarkColor }"
        />
        <span
          v-if="triggerPrefixHtml"
          class="customSelectTriggerPrefix"
          aria-hidden="true"
          v-html="triggerPrefixHtml"
        />
        <span class="customSelectTriggerLabelWithCount">
          <span class="customSelectTriggerLabel">{{ displayLabel }}</span>
          <span v-if="displaySuffix?.trim()" class="appShellMenuItemSuffix">{{
            displaySuffix
          }}</span>
        </span>
      </span>
      <span class="customSelectChevron" aria-hidden="true">▾</span>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        data-fullscreen-sidebar-float
        class="customSelectPanel appShellMenuPanel"
        role="listbox"
        :style="{
          left: `${posLeft}px`,
          top: `${posTop}px`,
          width: `${panelWidth}px`,
        }"
        @click.stop
      >
        <div class="customSelectSection">
          <template v-for="(raw, idx) in fixedTopItems" :key="'t' + idx">
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
        </div>
        <div
          ref="scrollAreaRef"
          class="customSelectScroll"
          :class="{
            'customSelectScroll--scrollbarPad': scrollAreaHasScrollbar,
          }"
          :style="{ maxHeight: `${scrollMaxHeight}px` }"
        >
          <template v-for="(raw, idx) in scrollItems" :key="'s' + idx">
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
        </div>
        <div class="customSelectSection">
          <template v-for="(raw, idx) in fixedBottomItems" :key="'b' + idx">
            <div v-if="raw.kind === 'divider'" class="appShellMenuDivider" />
            <button
              v-else-if="raw.kind === 'item'"
              type="button"
              role="option"
              :aria-selected="!raw.actionOnly && raw.id === modelValue"
              :class="itemButtonClass(raw)"
              :disabled="raw.disabled"
              @click="raw.disabled ? undefined : selectItem(raw)"
            >
              <span
                v-if="showItemColorMark(raw)"
                class="appShellMenuItemMark"
                aria-hidden="true"
                :style="{ backgroundColor: itemMarkBackground(raw) }"
              />
              <span class="appShellMenuItemRowBody">
                <span
                  v-if="raw.prefixHtml"
                  class="appShellMenuItemPrefix"
                  aria-hidden="true"
                  v-html="raw.prefixHtml"
                />
                <span class="appShellMenuItemLabelWithCount">
                  <span class="appShellMenuItemLabelText">{{ raw.label }}</span>
                  <span
                    v-if="raw.labelSuffix?.trim()"
                    class="appShellMenuItemSuffix"
                    >{{ raw.labelSuffix }}</span
                  >
                </span>
              </span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.customSelect {
  position: relative;
  min-width: 0;
  flex: 1;
}
/* 与全局 .btn 一致；展开时保持与 :hover 相同（accent 描边/字色） */
.customSelectTrigger.btn {
  flex-shrink: 1;
  min-width: 0;
}
.customSelectTrigger {
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  text-align: left;
  white-space: nowrap;
  padding: 4px 4px 4px 8px;
}
.customSelectTrigger[aria-expanded="true"] {
  color: var(--accent);
  border-color: var(--accent);
}
.customSelectTriggerStart {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  justify-content: flex-start;
}
.customSelectTriggerMark {
  flex-shrink: 0;
  width: 3px;
  height: 12px;
  border-radius: 2px;
  margin-bottom: -2px;
  box-sizing: border-box;
}
.customSelectTriggerLabelWithCount {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.customSelectTriggerPrefix {
  flex-shrink: 0;
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
}
.customSelectTriggerPrefix :deep(svg) {
  width: 14px;
  height: 14px;
  display: block;

  path {
    fill: var(--secondary);
  }
}
.customSelectTriggerLabel {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.customSelectChevron {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 16px;
  line-height: 16px;
  opacity: 0.7;
}
.customSelectPanel {
  position: fixed;
  z-index: 7200;
  box-sizing: border-box;
  min-width: 140px;
}
.customSelectSection {
  flex-shrink: 0;
}
.customSelectScroll {
  overflow-y: auto;
  min-height: 0;
  box-sizing: border-box;
}

/* 有纵向滚动条时：与轨道留出间距；无条时不加此类，左右与固定区一致 */
.customSelectScroll--scrollbarPad {
  padding-right: 8px;
}
</style>
