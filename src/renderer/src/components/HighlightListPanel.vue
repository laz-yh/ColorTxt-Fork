<script setup lang="ts">
import { icons } from "../icons";

withDefaults(
  defineProps<{
    highlightTerms: Array<{ text: string; color: string; colorIndex: number }>;
    highlightPreviewBg?: string;
    monacoFontFamily: string;
  }>(),
  {
    highlightTerms: () => [],
    highlightPreviewBg: "var(--reader-bg, var(--bg))",
  },
);

const emit = defineEmits<{
  findHighlightTerm: [text: string];
  removeHighlightTerm: [text: string];
  clearHighlights: [];
}>();

function onRemoveHighlightTermClick(ev: MouseEvent, text: string) {
  ev.preventDefault();
  ev.stopPropagation();
  emit("removeHighlightTerm", text);
}
</script>

<template>
  <div class="highlightPanelWrap">
    <div class="highlightPanelBody">
      <div v-if="highlightTerms.length === 0" class="highlightEmpty">
        当前文件暂无高亮词
      </div>
      <div v-else class="highlightList">
        <div
          v-for="item in highlightTerms"
          :key="`${item.colorIndex}-${item.text}`"
          class="highlightItem"
          :style="{
            backgroundColor: highlightPreviewBg,
            fontFamily: monacoFontFamily,
          }"
          @click="emit('findHighlightTerm', item.text)"
        >
          <span class="highlightText" :style="{ color: item.color }">
            {{ item.text }}
          </span>
          <button
            type="button"
            class="highlightRemoveBtn"
            title="移除高亮词"
            aria-label="移除高亮词"
            @click="onRemoveHighlightTermClick($event, item.text)"
          >
            <span class="highlightRemoveIcon" v-html="icons.close"></span>
          </button>
        </div>
      </div>
    </div>
    <div v-if="highlightTerms.length > 0" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat">共 {{ highlightTerms.length }} 个高亮词</span>
      <button
        type="button"
        class="link danger hoverMode sidebarTabFooterAction"
        @click="emit('clearHighlights')"
      >
        清空
      </button>
    </div>
  </div>
</template>

<style scoped>
.highlightPanelWrap {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.highlightPanelBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 6px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.highlightList {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.highlightItem {
  border-radius: 4px;
  min-height: 34px;
  padding: 6px 4px 6px 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.highlightText {
  min-width: 0;
  flex: 1 1 auto;
  font-size: 16px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.highlightRemoveBtn {
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--muted);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.highlightItem:hover .highlightRemoveBtn,
.highlightItem:focus-within .highlightRemoveBtn {
  opacity: 1;
  pointer-events: auto;
}

.highlightRemoveBtn:hover {
  color: var(--danger);
}

.highlightRemoveIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.highlightRemoveIcon :deep(svg) {
  width: 9px;
  height: 9px;
  display: block;
}

.highlightRemoveIcon :deep(path) {
  fill: currentColor;
}

.highlightEmpty {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  color: var(--secondary);
  font-size: 12px;
  text-align: center;
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
  min-width: 0;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebarTabFooterAction {
  flex: 0 0 auto;
  white-space: nowrap;
  padding: 0;
}
</style>
