<script setup lang="ts">
import NumericInput from "./NumericInput.vue";
import SwitchToggle from "./SwitchToggle.vue";
import PathPickerInput from "./PathPickerInput.vue";
import {
  maxChapterMinCharCount,
  maxRecentFilesHistoryLimit,
  minChapterMinCharCount,
} from "../constants/appUi";

defineProps<{
  draftRestore: boolean;
  draftSyncCurrentFile: boolean;
  draftRecentLimit: number;
  draftChapterMinCharCount: number;
  draftEbookConvertOutputDir: string;
}>();

defineEmits<{
  "update:draftRestore": [v: boolean];
  "update:draftSyncCurrentFile": [v: boolean];
  "update:draftRecentLimit": [v: number];
  "update:draftChapterMinCharCount": [v: number];
  "update:draftEbookConvertOutputDir": [v: string];
  clearCache: [];
  exportConfig: [];
  importConfig: [];
}>();
</script>

<template>
  <div class="settingsBody">
    <div class="settingsRow">
      <div class="settingsRowMain">
        <span class="settingsLabel">启动时恢复上次关闭的文件</span>
        <SwitchToggle
          :model-value="draftRestore"
          aria-label="启动时恢复上次关闭的文件"
          @update:model-value="$emit('update:draftRestore', $event)"
        />
      </div>
      <p class="settingsHint">
        关闭后，退出应用时不再保存当前阅读会话（打开的文件及阅读位置）。
      </p>
    </div>

    <div class="settingsRow">
      <div class="settingsRowMain">
        <span class="settingsLabel">同步当前文件</span>
        <SwitchToggle
          :model-value="draftSyncCurrentFile"
          aria-label="同步当前文件"
          @update:model-value="$emit('update:draftSyncCurrentFile', $event)"
        />
      </div>
      <p class="settingsHint">
        开启后，如果当前正在阅读的文件被修改，将自动重新加载。
      </p>
    </div>

    <div class="settingsRow">
      <div class="settingsRowMain settingsRowMain--baseline">
        <span class="settingsLabel">历史记录数量</span>
        <NumericInput
          :model-value="draftRecentLimit"
          :min="0"
          :max="maxRecentFilesHistoryLimit"
          integer
          aria-label="历史记录数量"
          @update:model-value="$emit('update:draftRecentLimit', $event)"
        />
      </div>
      <p class="settingsHint">
        最近打开文件的保留条数；设置为 0 时不记录最近打开的文件。
      </p>
    </div>

    <div class="settingsRow">
      <div class="settingsRowMain settingsRowMain--baseline">
        <span class="settingsLabel short">电子书转换缓存目录</span>
        <div class="settingsEbookDirActions">
          <PathPickerInput
            :model-value="draftEbookConvertOutputDir"
            is-directory
            placeholder="源文件目录"
            aria-label="电子书转换缓存目录"
            class="settingsEbookPathPicker"
            @update:model-value="
              $emit('update:draftEbookConvertOutputDir', $event)
            "
          />
        </div>
      </div>
      <p class="settingsHint">
        打开其他格式的电子书时，会自动转换为 txt 格式并缓存到该目录下；<br />如果放空，将缓存到源文件同目录下。
      </p>
    </div>

    <div class="settingsRow">
      <div class="settingsRowMain settingsRowMain--baseline">
        <span class="settingsLabel">章节最少字数</span>
        <NumericInput
          :model-value="draftChapterMinCharCount"
          :min="minChapterMinCharCount"
          :max="maxChapterMinCharCount"
          integer
          aria-label="章节最少字数"
          @update:model-value="$emit('update:draftChapterMinCharCount', $event)"
        />
      </div>
      <p class="settingsHint">
        少于该字数的将不会被识别为章节；设置为 0 时不限制。
      </p>
    </div>

    <div class="settingsRow settingsRow--cache">
      <div class="settingsRowMain">
        <span class="settingsLabel">清除缓存</span>
        <button
          class="btn warning"
          type="button"
          size="large"
          @click="$emit('clearCache')"
        >
          清除缓存
        </button>
      </div>
      <p class="settingsHint">清除本地缓存数据（不影响界面相关的设置）。</p>
    </div>

    <div class="settingsRow settingsRow--data">
      <div class="settingsRowMain">
        <span class="settingsLabel">导出配置</span>
        <button
          class="btn"
          type="button"
          size="large"
          @click="$emit('exportConfig')"
        >
          导出配置
        </button>
      </div>
      <p class="settingsHint">
        将所有本地配置导出为 JSON 文件（含界面设置、阅读进度、书签、高亮词等），可保存到任意位置。
      </p>
    </div>

    <div class="settingsRow settingsRow--data">
      <div class="settingsRowMain">
        <span class="settingsLabel">导入配置</span>
        <button
          class="btn"
          type="button"
          size="large"
          @click="$emit('importConfig')"
        >
          导入配置
        </button>
      </div>
      <p class="settingsHint">
        从 JSON 文件导入配置，将覆盖当前 localStorage 中 ColorTxt 的所有本地数据。
      </p>
    </div>
  </div>
</template>

<style scoped>
.settingsBody {
  padding: 8px 0 4px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  background-color: var(--bg);
  border-radius: 8px;
  /* border: 1px solid var(--border); */
}

.settingsRow {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settingsRow--cache,
.settingsRow--data {
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.settingsRowMain {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
}

.settingsRowMain--baseline {
  align-items: baseline;
}

.settingsEbookDirActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 1 1 65%;
  min-width: 0;
}

.settingsEbookPathPicker {
  flex: 1;
  min-width: 0;
  max-width: 100%;
}

.settingsLabel {
  font-size: 14px;
  color: var(--fg);
  flex: 1 1 60%;
  min-width: 60%;
}
.settingsLabel.short {
  flex: 1 1 30%;
  min-width: 30%;
}

.settingsHint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
</style>
