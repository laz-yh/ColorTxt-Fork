<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import VirtualList from "./VirtualList.vue";
import { READER_SIDEBAR_ROW_STRIDE } from "../composables/useReaderSidebarLists";

type SearchRange = { start: number; end: number };
type SearchResultItem = {
  physicalLine: number;
  displayLine: number;
  text: string;
  ranges: SearchRange[];
};

const props = withDefaults(
  defineProps<{
    currentFilePath: string | null;
    query: string;
    results: SearchResultItem[];
    loading?: boolean;
    active?: boolean;
    matchCase?: boolean;
    wholeWord?: boolean;
    useRegex?: boolean;
    activePhysicalLine?: number | null;
  }>(),
  {
    loading: false,
    active: false,
    matchCase: false,
    wholeWord: false,
    useRegex: false,
    activePhysicalLine: null,
  },
);

const emit = defineEmits<{
  "update:query": [value: string];
  "update:matchCase": [value: boolean];
  "update:wholeWord": [value: boolean];
  "update:useRegex": [value: boolean];
  jumpToResult: [item: SearchResultItem];
}>();

const searchInputRef = ref<HTMLInputElement | null>(null);

function focusSearchInput() {
  void nextTick(() => {
    requestAnimationFrame(() => {
      searchInputRef.value?.focus();
    });
  });
}

watch(
  () => props.active,
  (isActive) => {
    if (!isActive) return;
    if (props.query.trim()) return;
    focusSearchInput();
  },
);

function onToggleMatchCase() {
  emit("update:matchCase", !props.matchCase);
  focusSearchInput();
}

function onToggleWholeWord() {
  emit("update:wholeWord", !props.wholeWord);
  focusSearchInput();
}

function onToggleUseRegex() {
  emit("update:useRegex", !props.useRegex);
  focusSearchInput();
}

function linePreview(text: string) {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : "（空行）";
}

function remapRangesForTrimmedPreview(text: string, ranges: SearchRange[]) {
  const trimmed = text.trim();
  if (!trimmed) return { preview: "（空行）", ranges: [] as SearchRange[] };
  const startOffset = text.indexOf(trimmed);
  const endOffset = startOffset + trimmed.length;
  const nextRanges: SearchRange[] = [];
  for (const r of ranges) {
    const start = Math.max(r.start, startOffset);
    const end = Math.min(r.end, endOffset);
    if (end <= start) continue;
    nextRanges.push({
      start: start - startOffset,
      end: end - startOffset,
    });
  }
  return { preview: trimmed, ranges: nextRanges };
}

function buildSegmentsByRanges(text: string, ranges: SearchRange[]) {
  if (!text) return [{ text: "", highlight: false }];
  if (!ranges.length) return [{ text, highlight: false }];
  const segments: Array<{ text: string; highlight: boolean }> = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(0, Math.min(range.start, text.length));
    const end = Math.max(start, Math.min(range.end, text.length));
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlight: false });
    }
    if (end > start) {
      segments.push({ text: text.slice(start, end), highlight: true });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlight: false });
  }
  return segments.length > 0 ? segments : [{ text, highlight: false }];
}
</script>

<template>
  <div class="searchPanelWrap">
    <div class="searchToolbar">
      <div class="searchInputRow">
        <input
          ref="searchInputRef"
          type="search"
          class="searchInput"
          :value="props.query"
          placeholder="搜索当前文件"
          @input="emit('update:query', ($event.target as HTMLInputElement).value)"
        />
        <div class="searchOptionGroup" role="group" aria-label="搜索选项">
          <button
            type="button"
            class="searchOptionBtn"
            :class="{ active: props.matchCase }"
            title="区分大小写"
            @click="onToggleMatchCase"
          >
            Aa
          </button>
          <button
            type="button"
            class="searchOptionBtn"
            :class="{ active: props.wholeWord }"
            title="全字匹配"
            @click="onToggleWholeWord"
          >
            ab
          </button>
          <button
            type="button"
            class="searchOptionBtn"
            :class="{ active: props.useRegex }"
            title="使用正则表达式"
            @click="onToggleUseRegex"
          >
            .*
          </button>
        </div>
      </div>
    </div>
    <div class="searchBody">
      <div v-if="!props.currentFilePath" class="searchEmpty">未打开文件</div>
      <div v-else-if="!props.query.trim()" class="searchEmpty">请输入关键词</div>
      <div v-else-if="props.loading" class="searchEmpty">搜索中...</div>
      <div v-else-if="props.results.length === 0" class="searchEmpty">未找到匹配结果</div>
      <div v-else class="searchResultViewport">
        <VirtualList
          class="searchResultList sidebarList"
          :item-count="props.results.length"
          :row-stride="READER_SIDEBAR_ROW_STRIDE"
          :overscan="12"
          :item-key="(i) => `${props.results[i]?.physicalLine}-${props.results[i]?.displayLine}`"
        >
          <template #default="{ index }">
            <button
              type="button"
              class="searchResultItem"
              :class="{
                active: props.results[index].physicalLine === props.activePhysicalLine,
              }"
              :title="linePreview(props.results[index].text)"
              @click="emit('jumpToResult', props.results[index])"
            >
              <span class="searchResultText">
                <template
                  v-for="(segment, idx) in (() => {
                    const d = remapRangesForTrimmedPreview(
                      props.results[index].text,
                      props.results[index].ranges,
                    );
                    return buildSegmentsByRanges(d.preview, d.ranges);
                  })()"
                  :key="idx"
                >
                  <mark v-if="segment.highlight" class="searchHit">{{
                    segment.text
                  }}</mark>
                  <span v-else>{{ segment.text }}</span>
                </template>
              </span>
              <span class="searchResultLine">{{ props.results[index].physicalLine }} 行</span>
            </button>
          </template>
        </VirtualList>
      </div>
    </div>
    <div v-if="props.query.trim()" class="sidebarTabFooter">
      <span class="sidebarTabFooterStat">共 {{ props.results.length }} 个结果</span>
    </div>
  </div>
</template>

<style scoped>
.searchPanelWrap {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.searchToolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  padding: 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.searchInputRow {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  border-radius: 4px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  transition: border-color 0.2s;
}

.searchInputRow:focus-within {
  border-color: var(--accent);
}

.searchInput {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
}

.searchOptionGroup {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 3px;
}

.searchOptionBtn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}

.searchOptionBtn:hover {
  color: var(--fg);
  background: var(--list-item-bg-hover);
}

.searchOptionBtn.active {
  color: var(--fg);
  background: var(--list-item-bg-active);
}

.searchBody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

.searchEmpty {
  box-sizing: border-box;
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  font-size: 12px;
  color: var(--secondary);
  padding: 10px 16px;
}

.searchResultViewport {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.searchResultList {
  flex: 1 1 auto;
  min-height: 0;
}

.searchResultList :deep(.virtualList-row) {
  padding-bottom: 5px;
}

.searchResultItem {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 4px;
  padding: 0 10px;
  text-align: left;
  background: transparent;
  color: var(--list-item-fg);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.searchResultItem:hover {
  background: var(--list-item-bg-hover);
}

.searchResultItem.active {
  color: var(--list-item-fg-active);
  background: var(--list-item-bg-active);
}

.searchResultLine {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--muted);
}

.searchResultText {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.searchHit {
  background: var(--search-hit-bg);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
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
</style>
