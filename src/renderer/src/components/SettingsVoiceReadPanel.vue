<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppCheckbox from "./AppCheckbox.vue";
import ApiEndpointInput from "./ApiEndpointInput.vue";
import AppCustomSelect, { type CustomSelectItem } from "./AppCustomSelect.vue";
import AppConnectionTestButton from "./AppConnectionTestButton.vue";
import PathPickerInput from "./PathPickerInput.vue";
import IconButton from "./IconButton.vue";
import RangeSlider from "./RangeSlider.vue";
import SwitchToggle from "./SwitchToggle.vue";
import { icons } from "../icons";
import {
  mergeVoiceReadSettings,
  VOICE_READ_DIALOGUE_QUOTE_OPTIONS,
  voiceReadAiSpeakerRecognitionActive,
  voiceReadEngineRequiresCredentials,
  voiceReadEngineSupportsMultiVoiceScheme,
  voiceReadEngineSupportsPitch,
  voiceReadEngineSupportsRate,
  type VoiceReadDialogueQuoteStyle,
  type VoiceReadEngineId,
  type VoiceReadMultiVoiceSettings,
  type VoiceReadScheme,
  type VoiceReadSingleVoiceSettings,
  type VoiceReadSettings,
} from "../constants/voiceRead";
import {
  DASHSCOPE_API_KEY_CONSOLE_URL,
} from "@shared/apiEndpointPresets";
import {
  getVoiceReadEngineMeta,
  VOICE_READ_ENGINE_REGISTRY,
} from "@shared/voiceReadEngines";
import {
  DEFAULT_DASHSCOPE_TTS_MODEL,
  getDashscopeTtsModelSuggestions,
} from "@shared/voiceReadDashscopeModels";
import {
  DEFAULT_MINIMAX_TTS_MODEL,
  getMinimaxTtsModelSuggestions,
} from "@shared/voiceReadMinimaxModels";
import {
  DEFAULT_MIMO_TTS_MODEL,
  getMimoTtsModelSuggestions,
  isMimoTtsPresetModel,
  isMimoTtsVoiceCloneModel,
  isMimoTtsVoiceDesignModel,
  normalizeMimoTtsModel,
} from "@shared/voiceReadMimoModels";
import { healthCheckVoiceReadViaIpc } from "../services/voiceRead/voiceReadSynthesisClient";
import {
  fetchMinimaxVoiceCatalog,
  minimaxVoiceCatalogError,
} from "../services/voiceRead/minimaxVoiceCatalog";
import { useSecretStorageHint } from "../composables/useSecretStorageHint";
import type { ConnectionTestResult } from "../composables/useConnectionTest";
import { appAlert } from "../services/appDialog";
import { buildLineSpeakChunks } from "../services/voiceRead/voiceReadLineBuild";
import {
  buildDialogueAiPreviewSpeakChunks,
  buildMultiVoicePreviewSpeakChunks,
  VOICE_READ_DIALOGUE_GENDER_PREVIEW_DEFAULT,
} from "../services/voiceRead/voiceReadDialoguePreview";
import {
  VoiceReadLinePlayer,
  type VoiceReadPreviewDownload,
} from "../services/voiceRead/voiceReadLinePlayer";
import type { VoiceReadSpeakChunk } from "../services/voiceRead/voiceReadVoiceResolve";
import {
  getVoiceGroupsForEngine,
  resolveDefaultVoicePatchForEngine,
  resolveVoiceReadDisplayLabel,
  voiceSelectItemsForEngine,
} from "../utils/voiceReadVoiceGroups";
import type { CharacterRosterEntry } from "@shared/characterTypes";
import { MAX_VOICE_READ_PROFILES } from "@shared/voiceReadProfiles";
import type { VoiceReadProfile } from "@shared/voiceReadProfiles";
import { useVoiceReadProfileDraft } from "../composables/useVoiceReadProfileDraft";
import AiConfigProfileToolbar from "./AiConfigProfileToolbar.vue";
import type { AITokenPricePerMillion } from "@shared/aiTypes";
import { formatTokenUsageSummaryLine } from "@shared/aiTokenUsage";
import {
  clearVoiceReadAiSpeakerTokenUsage,
  voiceReadAiSpeakerTokenUsage,
} from "../services/voiceRead/voiceReadAiSpeakerTokenUsage";

const settings = defineModel<VoiceReadSettings>({ required: true });
const profiles = defineModel<VoiceReadProfile[]>("profiles", { required: true });
const activeProfileId = defineModel<string>("activeProfileId", { required: true });

const props = defineProps<{
  aiEnabled?: boolean;
  characterRoster?: readonly CharacterRosterEntry[];
}>();

const voiceReadProfileDraft = useVoiceReadProfileDraft(
  settings,
  profiles,
  activeProfileId,
);

const draft = settings;

const { secretStorageHint } = useSecretStorageHint();

const chatTokenPricePerMillion = ref<AITokenPricePerMillion | null>(null);

const voiceReadAiTokenUsageLine = computed(() =>
  formatTokenUsageSummaryLine(
    voiceReadAiSpeakerTokenUsage.value,
    true,
    chatTokenPricePerMillion.value,
    "累计消耗 Token",
  ),
);

function onClearVoiceReadAiTokenUsage() {
  clearVoiceReadAiSpeakerTokenUsage();
}

const selectListsEmpty: CustomSelectItem[] = [];

const schemeOptions: { id: VoiceReadScheme; label: string; description: string }[] =
  [
    { id: "single", label: "单音色", description: "全书使用同一音色" },
    {
      id: "multi",
      label: "旁白/对白多音色",
      description: "旁白与对白可使用不同音色",
    },
  ];

const schemeScrollItems: CustomSelectItem[] = schemeOptions.map((o) => ({
  kind: "item",
  id: o.id,
  label: o.label,
  description: o.description,
}));

const supportsMultiVoiceScheme = computed(() =>
  voiceReadEngineSupportsMultiVoiceScheme(
    draft.value.engine,
    draft.value.engineConfig,
  ),
);

const schemeScrollItemsForDraft = computed(() =>
  supportsMultiVoiceScheme.value
    ? schemeScrollItems
    : schemeScrollItems.filter(
        (item) => item.kind === "item" && item.id === "single",
      ),
);

const schemeDisplayLabel = computed(() => {
  const hit = schemeOptions.find((o) => o.id === draft.value.scheme);
  return hit?.label ?? draft.value.scheme;
});

const isMultiScheme = computed(
  () => draft.value.scheme === "multi" && supportsMultiVoiceScheme.value,
);

const showAiSpeakerRecognitionToggle = computed(
  () => isMultiScheme.value && props.aiEnabled === true,
);

const showDialogueGenderVoices = computed(
  () =>
    isMultiScheme.value &&
    props.aiEnabled === true &&
    draft.value.multi.aiSpeakerRecognitionEnabled !== false,
);

const engineOptions = VOICE_READ_ENGINE_REGISTRY.map((m) => ({
  id: m.id,
  label: m.label,
  description: m.description,
}));

const engineMeta = computed(() => getVoiceReadEngineMeta(draft.value.engine));

const showApiKeyFields = computed(() => engineMeta.value.auth === "apiKey");

const showDashScopeModel = computed(() => draft.value.engine === "dashscope");

const showMiniMaxModel = computed(() => draft.value.engine === "minimax");

const showMimoModel = computed(() => draft.value.engine === "mimo");

const mimoTtsModel = computed(() =>
  normalizeMimoTtsModel(draft.value.engineConfig.mimoModel),
);

const showMimoVoiceDescription = computed(
  () =>
    draft.value.engine === "mimo" &&
    isMimoTtsVoiceDesignModel(mimoTtsModel.value),
);

const showMimoReferenceAudio = computed(
  () =>
    draft.value.engine === "mimo" &&
    isMimoTtsVoiceCloneModel(mimoTtsModel.value),
);

const showMimoPresetVoicePicker = computed(() => {
  if (draft.value.engine !== "mimo") return true;
  return isMimoTtsPresetModel(mimoTtsModel.value);
});

const engineScrollItems: CustomSelectItem[] = engineOptions.map((o) => ({
  kind: "item",
  id: o.id,
  label: o.label,
  description: o.description,
}));

const engineDisplayLabel = computed(() => {
  const hit = engineOptions.find((o) => o.id === draft.value.engine);
  return hit?.label ?? draft.value.engine;
});

function openDashScopeApiKeyPage() {
  void window.colorTxt.openExternal(DASHSCOPE_API_KEY_CONSOLE_URL);
}

async function runDashscopeConnectionTest(): Promise<ConnectionTestResult | null> {
  const key =
    draft.value.engineConfig.dashscopeApiKey?.trim() ??
    draft.value.dashscopeApiKey?.trim() ??
    "";
  if (!key) {
    await appAlert("请先填写阿里云通义 API 密钥");
    return null;
  }
  const r = await healthCheckVoiceReadViaIpc("dashscope", {
    ...draft.value.engineConfig,
    dashscopeApiKey: key,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return r.result.ok
    ? { ok: true }
    : { ok: false, error: r.result.message ?? "连接失败" };
}

async function runMinimaxConnectionTest(): Promise<ConnectionTestResult | null> {
  if (!draft.value.engineConfig.minimaxApiKey?.trim()) {
    await appAlert("请先填写 MiniMax API 密钥");
    return null;
  }
  const r = await healthCheckVoiceReadViaIpc(
    "minimax",
    draft.value.engineConfig,
  );
  if (!r.ok) return { ok: false, error: r.error };
  return r.result.ok
    ? { ok: true }
    : { ok: false, error: r.result.message ?? "连接失败" };
}

async function runMimoConnectionTest(): Promise<ConnectionTestResult | null> {
  if (!draft.value.engineConfig.mimoApiKey?.trim()) {
    await appAlert("请先填写 MiMo API 密钥");
    return null;
  }
  const r = await healthCheckVoiceReadViaIpc("mimo", draft.value.engineConfig);
  if (!r.ok) return { ok: false, error: r.error };
  return r.result.ok
    ? { ok: true }
    : { ok: false, error: r.result.message ?? "连接失败" };
}

const previewText = ref(VOICE_READ_DIALOGUE_GENDER_PREVIEW_DEFAULT);

type PreviewPhase = "idle" | "ai" | "synthesizing" | "playing";
const previewPhase = ref<PreviewPhase>("idle");
const previewError = ref("");
const previewDownload = ref<VoiceReadPreviewDownload | null>(null);

const showDashScopeKey = ref(false);
const showMiniMaxKey = ref(false);
const showMimoKey = ref(false);

const minimaxConnectionFingerprint = computed(
  () => draft.value.engineConfig.minimaxApiKey?.trim() ?? "",
);
const mimoConnectionFingerprint = computed(
  () => draft.value.engineConfig.mimoApiKey?.trim() ?? "",
);
const dashscopeConnectionFingerprint = computed(
  () =>
    draft.value.engineConfig.dashscopeApiKey?.trim() ??
    draft.value.dashscopeApiKey?.trim() ??
    "",
);
const previewPlayer = new VoiceReadLinePlayer();
let previewRunId = 0;

function voiceIdForSinglePreview(): string {
  return draft.value.single.voiceId;
}

function isPreviewBusy(): boolean {
  return previewPhase.value !== "idle";
}

const previewButtonLabel = computed(() => {
  if (previewPhase.value === "playing") return "停止";
  switch (previewPhase.value) {
    case "ai":
      return "AI 识别中…";
    case "synthesizing":
      return "语音合成中…";
    default:
      return "试听";
  }
});

const previewButtonClass = computed(() => {
  if (previewPhase.value === "playing") return "danger";
  if (previewPhase.value === "ai") return "warning";
  if (previewPhase.value === "synthesizing") return "primary";
  return "primary";
});

const isPreviewPlaying = computed(() => previewPhase.value === "playing");

function previewPhaseAfterAi(settings: VoiceReadSettings): PreviewPhase {
  return settings.engine === "system" ? "playing" : "synthesizing";
}

const systemVoices = ref<SpeechSynthesisVoice[]>([]);

function refreshSystemVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  systemVoices.value = window.speechSynthesis.getVoices();
}

onMounted(() => {
  refreshSystemVoices();
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => refreshSystemVoices();
  }
  void (async () => {
    try {
      const c = await window.colorTxt.ai.configGet();
      chatTokenPricePerMillion.value = c.chat?.tokenPricePerMillion ?? null;
    } catch {
      chatTokenPricePerMillion.value = null;
    }
  })();
});

watch(
  () =>
    [
      draft.value.engine,
      draft.value.engineConfig.minimaxApiKey?.trim() ?? "",
    ] as const,
  ([engine, apiKey]) => {
    if (engine === "minimax" && apiKey) {
      void fetchMinimaxVoiceCatalog(draft.value.engineConfig, { force: true });
    }
  },
  { immediate: true },
);

function voiceScrollItemsForEngine(): CustomSelectItem[] {
  return voiceSelectItemsForEngine(
    draft.value.engine,
    systemVoices.value,
    draft.value.engineConfig,
  );
}

const voiceScrollItems = computed(() => voiceScrollItemsForEngine());

const voiceScrollHasOptions = computed(() =>
  voiceScrollItems.value.some((i) => i.kind === "item"),
);

const voiceScrollMaxHeight = computed(() =>
  getVoiceGroupsForEngine(draft.value.engine, systemVoices.value) === "flat"
    ? 280
    : 360,
);

const voiceDisplayLabel = computed(() =>
  resolveVoiceReadDisplayLabel(
    draft.value.engine,
    draft.value.single.voiceId,
    systemVoices.value,
  ),
);

const narrationVoiceDisplayLabel = computed(() =>
  resolveVoiceReadDisplayLabel(
    draft.value.engine,
    draft.value.multi.narrationVoiceId,
    systemVoices.value,
  ),
);

const dialogueVoiceDisplayLabel = computed(() =>
  resolveVoiceReadDisplayLabel(
    draft.value.engine,
    draft.value.multi.dialogueVoiceId,
    systemVoices.value,
  ),
);

const dialogueMaleVoiceDisplayLabel = computed(() =>
  resolveVoiceReadDisplayLabel(
    draft.value.engine,
    draft.value.multi.dialogueMaleVoiceId,
    systemVoices.value,
  ),
);

const dialogueFemaleVoiceDisplayLabel = computed(() =>
  resolveVoiceReadDisplayLabel(
    draft.value.engine,
    draft.value.multi.dialogueFemaleVoiceId,
    systemVoices.value,
  ),
);

function isQuoteStyleChecked(id: VoiceReadDialogueQuoteStyle): boolean {
  return draft.value.multi.dialogueQuoteStyles.includes(id);
}

function toggleQuoteStyle(id: VoiceReadDialogueQuoteStyle, checked: boolean) {
  const cur = [...draft.value.multi.dialogueQuoteStyles];
  const idx = cur.indexOf(id);
  if (checked) {
    if (idx < 0) cur.push(id);
  } else {
    if (cur.length <= 1) return;
    if (idx >= 0) cur.splice(idx, 1);
  }
  patchMultiVoice({ dialogueQuoteStyles: cur });
}

watch(
  () => draft.value.engine,
  (eng, prev) => {
    if (eng === prev) return;
    if (eng === "system") refreshSystemVoices();
    const patch = resolveDefaultVoicePatchForEngine(eng, systemVoices.value);
    patchDraft({
      single: patch.single,
      multi: { ...draft.value.multi, ...patch.multi },
    });
  },
);

function restoreDefaultPreviewText() {
  previewText.value = VOICE_READ_DIALOGUE_GENDER_PREVIEW_DEFAULT;
  if (isPreviewBusy()) cancelPreview();
  else {
    previewError.value = "";
    clearPreviewDownload();
  }
}

function patchDraft(p: Partial<VoiceReadSettings>) {
  settings.value = mergeVoiceReadSettings({ ...draft.value, ...p });
}

watch(supportsMultiVoiceScheme, (supported) => {
  if (!supported && draft.value.scheme === "multi") {
    patchDraft({ scheme: "single" });
  }
});

function patchSingleVoice(p: Partial<VoiceReadSingleVoiceSettings>) {
  patchDraft({ single: { ...draft.value.single, ...p } });
}

function patchMultiVoice(p: Partial<VoiceReadMultiVoiceSettings>) {
  patchDraft({ multi: { ...draft.value.multi, ...p } });
}

function patchEngineConfig(
  partial: Partial<VoiceReadSettings["engineConfig"]>,
) {
  patchDraft({
    engineConfig: { ...draft.value.engineConfig, ...partial },
  });
}

const dashscopeApiKeyModel = computed({
  get: () =>
    draft.value.engineConfig.dashscopeApiKey ??
    draft.value.dashscopeApiKey ??
    "",
  set: (value: string) => {
    patchEngineConfig({ dashscopeApiKey: value });
  },
});

const minimaxApiKeyModel = computed({
  get: () => draft.value.engineConfig.minimaxApiKey ?? "",
  set: (value: string) => {
    patchEngineConfig({ minimaxApiKey: value });
  },
});

const mimoApiKeyModel = computed({
  get: () => draft.value.engineConfig.mimoApiKey ?? "",
  set: (value: string) => {
    patchEngineConfig({ mimoApiKey: value });
  },
});

const mimoVoiceDescriptionModel = computed({
  get: () => draft.value.engineConfig.mimoVoiceDescription ?? "",
  set: (value: string) => {
    patchEngineConfig({ mimoVoiceDescription: value });
  },
});

const mimoOptimizeTextPreviewModel = computed({
  get: () => draft.value.engineConfig.mimoOptimizeTextPreview === true,
  set: (value: boolean) => {
    patchEngineConfig({ mimoOptimizeTextPreview: value });
  },
});

const mimoReferenceAudioPathModel = computed({
  get: () => draft.value.engineConfig.mimoReferenceAudioPath ?? "",
  set: (value: string) => {
    patchEngineConfig({ mimoReferenceAudioPath: value });
  },
});

function clearPreviewDownload() {
  previewDownload.value = null;
}

function cancelPreview() {
  previewRunId += 1;
  previewPlayer.onChunkChange = undefined;
  previewPlayer.onSynthesizingChange = undefined;
  previewPlayer.stop();
  previewPhase.value = "idle";
  previewError.value = "";
}

function buildPreviewSpeakChunks(
  settings: VoiceReadSettings,
  text: string,
  voiceId: string,
) {
  const previewSettings: VoiceReadSettings = {
    ...settings,
    scheme: "single",
    single: { ...settings.single, voiceId },
  };
  return buildLineSpeakChunks(previewSettings, text, []).chunks;
}

function schedulePreviewDownload(
  settings: VoiceReadSettings,
  text: string,
  chunks: VoiceReadSpeakChunk[],
  runId: number,
) {
  if (settings.engine === "system") return;
  void previewPlayer
    .buildLineDownloadable(settings, text, chunks)
    .then((item) => {
      if (runId !== previewRunId) return;
      previewDownload.value = item;
    })
    .catch(() => {
      if (runId !== previewRunId) return;
    });
}

async function onPreview() {
  if (isPreviewBusy()) return;
  const runId = ++previewRunId;
  const settings = { ...draft.value };
  const voiceId = voiceIdForSinglePreview();
  const needsAi =
    isMultiScheme.value &&
    voiceReadAiSpeakerRecognitionActive(settings, props.aiEnabled === true);
  previewError.value = "";
  clearPreviewDownload();
  previewPlayer.stop();
  previewPhase.value = needsAi ? "ai" : previewPhaseAfterAi(settings);

  const text = previewText.value.trim() || "试听";
  let speakChunks: VoiceReadSpeakChunk[] = [];
  let playbackStarted = false;

  const prevOnChunkChange = previewPlayer.onChunkChange;
  const prevOnSynthesizingChange = previewPlayer.onSynthesizingChange;

  previewPlayer.onChunkChange = (index, total) => {
    if (runId !== previewRunId) return;
    playbackStarted = true;
    previewPhase.value = "playing";
    prevOnChunkChange?.(index, total);
  };

  previewPlayer.onSynthesizingChange = (active) => {
    if (runId !== previewRunId) return;
    if (active) {
      previewPhase.value = "synthesizing";
    } else if (playbackStarted) {
      previewPhase.value = "playing";
    }
    prevOnSynthesizingChange?.(active);
  };

  try {
    if (isMultiScheme.value) {
      speakChunks = showDialogueGenderVoices.value
        ? await buildDialogueAiPreviewSpeakChunks(
            settings,
            text,
            props.characterRoster ?? [],
          )
        : buildMultiVoicePreviewSpeakChunks(settings, text);
    } else {
      speakChunks = buildPreviewSpeakChunks(settings, text, voiceId);
    }

    if (runId !== previewRunId) return;
    if (needsAi) {
      previewPhase.value = previewPhaseAfterAi(settings);
    }

    schedulePreviewDownload(settings, text, speakChunks, runId);

    if (speakChunks.length > 0) {
      await previewPlayer.speakChunks(settings, speakChunks);
    } else {
      const previewSettings: VoiceReadSettings = {
        ...settings,
        scheme: "single",
        single: { ...settings.single, voiceId },
      };
      await previewPlayer.speakLine(previewSettings, text);
    }
    if (runId !== previewRunId) return;
  } catch (e) {
    if (runId !== previewRunId) return;
    previewError.value = e instanceof Error ? e.message : String(e);
  } finally {
    previewPlayer.onChunkChange = prevOnChunkChange;
    previewPlayer.onSynthesizingChange = prevOnSynthesizingChange;
    if (runId === previewRunId) previewPhase.value = "idle";
  }
}

function onPreviewDownload() {
  const item = previewDownload.value;
  if (!item) return;
  const url = URL.createObjectURL(item.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = item.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const previewDisabled = computed(() => {
  if (isPreviewPlaying.value) return false;
  return (
    isPreviewBusy() || voiceReadEngineRequiresCredentials(draft.value)
  );
});

function onPreviewButtonClick() {
  if (isPreviewPlaying.value) {
    cancelPreview();
    return;
  }
  void onPreview();
}

watch(
  () =>
    [
      draft.value.scheme,
      draft.value.engine,
      draft.value.single.voiceId,
      draft.value.multi.narrationVoiceId,
      draft.value.multi.dialogueVoiceId,
      draft.value.multi.dialogueMaleVoiceId,
      draft.value.multi.dialogueFemaleVoiceId,
      draft.value.multi.aiSpeakerRecognitionEnabled,
      draft.value.multi.dialogueQuoteStyles.join(","),
      draft.value.dashscopeApiKey,
      draft.value.rate,
      draft.value.pitch,
      previewText.value,
    ] as const,
  () => {
    if (isPreviewBusy()) cancelPreview();
    else {
      previewError.value = "";
      clearPreviewDownload();
    }
  },
);

const rateDisabled = computed(
  () => !voiceReadEngineSupportsRate(draft.value.engine),
);
const showPitchControl = computed(() =>
  voiceReadEngineSupportsPitch(draft.value.engine),
);

const voiceReadProfileToolbarProfiles = computed(
  () => voiceReadProfileDraft.profileSelectItems.value,
);
const voiceReadProfileToolbarEditingId = computed(
  () => voiceReadProfileDraft.editingId.value,
);
const voiceReadProfileToolbarDisplayName = computed(
  () => voiceReadProfileDraft.editingDisplayName.value,
);
const voiceReadProfileToolbarPlaceholder = computed(
  () => voiceReadProfileDraft.editingProviderLabel.value,
);

function onVoiceReadProfileEditingIdChange(id: string) {
  if (isPreviewBusy()) cancelPreview();
  voiceReadProfileDraft.selectEditingProfile(id);
}

function initVoiceReadProfiles() {
  voiceReadProfileDraft.initFromState();
}

defineExpose({
  cancelPreview,
  finalizeVoiceReadProfiles: voiceReadProfileDraft.finalizeBeforeSave,
  initVoiceReadProfiles,
  resetCurrentVoiceReadProfile: voiceReadProfileDraft.resetCurrentProfileSettings,
});

onUnmounted(() => {
  cancelPreview();
});
</script>

<template>
  <div class="settingsBody">
    <section class="aiSection aiSection--compact">
      <AiConfigProfileToolbar
        :profiles="voiceReadProfileToolbarProfiles"
        :editing-id="voiceReadProfileToolbarEditingId"
        :display-name="voiceReadProfileToolbarDisplayName"
        :placeholder="voiceReadProfileToolbarPlaceholder"
        :max-profiles="MAX_VOICE_READ_PROFILES"
        @update:editing-id="onVoiceReadProfileEditingIdChange"
        @add="voiceReadProfileDraft.addProfile()"
        @rename="void voiceReadProfileDraft.renameProfile()"
        @delete="voiceReadProfileDraft.deleteProfile()"
      />
    </section>

    <section class="aiSection aiSection--compact">
      <div class="settingsRowMain settingsRowMain--baseline">
        <span class="settingsLabel short settingsLabel--strong">服务商</span>
        <AppCustomSelect
          class="settingsRowControl"
          :model-value="draft.engine"
          :display-label="engineDisplayLabel"
          :fixed-top-items="selectListsEmpty"
          :scroll-items="engineScrollItems"
          :fixed-bottom-items="selectListsEmpty"
          :scroll-max-height="280"
          ariaLabel="语音朗读服务商"
          @update:model-value="
            patchDraft({ engine: $event as VoiceReadEngineId })
          "
        />
      </div>

      <template v-if="showApiKeyFields">
        <div v-if="draft.engine === 'dashscope'" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API 密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showDashScopeKey ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                  v-model="dashscopeApiKeyModel"
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :title="showDashScopeKey ? '隐藏' : '显示'"
                  :aria-label="
                    showDashScopeKey ? '隐藏 API 密钥' : '显示 API 密钥'
                  "
                  @click="showDashScopeKey = !showDashScopeKey"
                >
                  <span
                    class="iconSvg"
                    v-html="showDashScopeKey ? icons.view : icons.viewOff"
                  />
                </button>
                <AppConnectionTestButton
                  :fingerprint="dashscopeConnectionFingerprint"
                  :on-test="runDashscopeConnectionTest"
                  title="仅校验 API 密钥有效性，不进行语音合成"
                />
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
        <div v-if="showDashScopeModel" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">模型</span>
            <div class="aiRowField">
              <ApiEndpointInput
                :model-value="
                  draft.engineConfig.dashscopeModel ?? DEFAULT_DASHSCOPE_TTS_MODEL
                "
                :suggestions="getDashscopeTtsModelSuggestions()"
                placeholder="输入模型 ID…"
                input-class="settingsStretchInput"
                aria-label="通义语音模型"
                :scroll-max-height="160"
                @update:model-value="patchEngineConfig({ dashscopeModel: $event })"
              />
            </div>
          </div>
          <p class="settingsHint">
            Instruct 支持自然语言语气控制。
          </p>
        </div>
        <div v-if="draft.engine === 'minimax'" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API 密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showMiniMaxKey ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                  v-model="minimaxApiKeyModel"
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :title="showMiniMaxKey ? '隐藏' : '显示'"
                  :aria-label="
                    showMiniMaxKey ? '隐藏 API 密钥' : '显示 API 密钥'
                  "
                  @click="showMiniMaxKey = !showMiniMaxKey"
                >
                  <span
                    class="iconSvg"
                    v-html="showMiniMaxKey ? icons.view : icons.viewOff"
                  />
                </button>
                <AppConnectionTestButton
                  :fingerprint="minimaxConnectionFingerprint"
                  :on-test="runMinimaxConnectionTest"
                  title="仅校验 API 密钥有效性，不进行语音合成"
                />
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
        <div v-if="showMiniMaxModel" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">模型</span>
            <div class="aiRowField">
              <ApiEndpointInput
                :model-value="
                  draft.engineConfig.minimaxModel ?? DEFAULT_MINIMAX_TTS_MODEL
                "
                :suggestions="getMinimaxTtsModelSuggestions()"
                placeholder="输入模型 ID…"
                input-class="settingsStretchInput"
                aria-label="MiniMax 语音模型"
                :scroll-max-height="220"
                @update:model-value="patchEngineConfig({ minimaxModel: $event })"
              />
            </div>
          </div>
          <p class="settingsHint">
            turbo 延迟更低、生成更快；hd 音质更高、生成较慢。
          </p>
          <p v-if="minimaxVoiceCatalogError" class="settingsHint">
            音色同步失败：{{ minimaxVoiceCatalogError }}（将使用本地预设音色）
          </p>
        </div>
        <div v-if="draft.engine === 'mimo'" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">API 密钥</span>
            <div class="aiRowField">
              <div class="settingsPasswordRow aiPasswordRow">
                <input
                  class="settingsStretchInput settingsPasswordRow__input"
                  :type="showMimoKey ? 'text' : 'password'"
                  autocomplete="off"
                  spellcheck="false"
                  v-model="mimoApiKeyModel"
                />
                <button
                  type="button"
                  class="btn iconOnly"
                  :title="showMimoKey ? '隐藏' : '显示'"
                  :aria-label="
                    showMimoKey ? '隐藏 API 密钥' : '显示 API 密钥'
                  "
                  @click="showMimoKey = !showMimoKey"
                >
                  <span
                    class="iconSvg"
                    v-html="showMimoKey ? icons.view : icons.viewOff"
                  />
                </button>
                <AppConnectionTestButton
                  :fingerprint="mimoConnectionFingerprint"
                  :on-test="runMimoConnectionTest"
                  title="仅校验 API 密钥有效性，不进行语音合成"
                />
              </div>
            </div>
          </div>
          <p class="settingsHint">{{ secretStorageHint }}</p>
        </div>
        <div v-if="showMimoModel" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">模型</span>
            <div class="aiRowField">
              <ApiEndpointInput
                :model-value="
                  draft.engineConfig.mimoModel ?? DEFAULT_MIMO_TTS_MODEL
                "
                :suggestions="getMimoTtsModelSuggestions()"
                placeholder="输入模型 ID…"
                input-class="settingsStretchInput"
                aria-label="MiMo 语音模型"
                :scroll-max-height="160"
                @update:model-value="patchEngineConfig({ mimoModel: $event })"
              />
            </div>
          </div>
          <p class="settingsHint">
            VoiceDesign 可定制音色，需填写声音描述；VoiceClone 可克隆音色，需选择参考音频（mp3/wav）。
          </p>
        </div>
        <div v-if="showMimoVoiceDescription" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">声音描述</span>
            <div class="aiRowField">
              <textarea
                v-model="mimoVoiceDescriptionModel"
                class="settingsStretchTextarea settingsStretchTextarea--multiline"
                rows="3"
                placeholder="例如：年轻男声，语速适中，语气自然亲切"
                aria-label="MiMo 声音描述"
              />
            </div>
          </div>
        </div>
        <div v-if="showMimoVoiceDescription" class="settingsRow">
          <div class="settingsRowMain">
            <span class="settingsLabel">智能润色</span>
            <SwitchToggle
              v-model="mimoOptimizeTextPreviewModel"
              aria-label="MiMo VoiceDesign 智能润色"
            />
          </div>
          <p class="settingsHint">
            开启后由模型改写为更适合口播的相近表达；关闭时严格朗读原文。
          </p>
        </div>
        <div v-if="showMimoReferenceAudio" class="settingsRow">
          <div class="settingsRowMain settingsRowMain--baseline">
            <span class="settingsLabel short">参考音频</span>
            <div class="aiRowField">
              <PathPickerInput
                v-model="mimoReferenceAudioPathModel"
                :is-directory="false"
                placeholder="选择 mp3 或 wav 参考音频"
                aria-label="MiMo 参考音频"
              />
            </div>
          </div>
          <p class="settingsHint">
            每次合成都会上传参考音频，长文连读可能较慢。
          </p>
        </div>
      </template>

      <div class="settingsRowMain">
        <span class="settingsLabel short">语速（{{ draft.rate.toFixed(2) }}）</span>
        <div class="settingsRowField">
          <RangeSlider
            :model-value="draft.rate"
            :min="0.5"
            :max="2"
            :step="0.05"
            :disabled="rateDisabled"
            :show-percent="false"
            aria-label="语速"
            @update:model-value="patchDraft({ rate: $event })"
          />
        </div>
      </div>
      <p v-if="rateDisabled" class="settingsHint">当前服务商不支持调节语速。</p>

      <div v-if="showPitchControl" class="settingsRowMain">
        <span class="settingsLabel short">音调（{{ draft.pitch.toFixed(2) }}）</span>
        <div class="settingsRowField">
          <RangeSlider
            :model-value="draft.pitch"
            :min="0.5"
            :max="2"
            :step="0.05"
            :show-percent="false"
            aria-label="音调"
            @update:model-value="patchDraft({ pitch: $event })"
          />
        </div>
      </div>

      <div v-if="supportsMultiVoiceScheme" class="settingsRowMain settingsRowMain--baseline">
        <span class="settingsLabel short settingsLabel--strong">朗读方案</span>
        <AppCustomSelect
          class="settingsRowControl"
          :model-value="draft.scheme"
          :display-label="schemeDisplayLabel"
          :fixed-top-items="selectListsEmpty"
          :scroll-items="schemeScrollItemsForDraft"
          :fixed-bottom-items="selectListsEmpty"
          :scroll-max-height="200"
          ariaLabel="朗读方案"
          @update:model-value="patchDraft({ scheme: $event as VoiceReadScheme })"
        />
      </div>

      <template v-if="isMultiScheme">
        <div class="settingsRowMain settingsRowMain--baseline">
          <span class="settingsLabel short">对白检测</span>
          <div class="settingsRowField voiceReadQuoteChecks">
            <AppCheckbox
              v-for="opt in VOICE_READ_DIALOGUE_QUOTE_OPTIONS"
              :key="opt.id"
              :model-value="isQuoteStyleChecked(opt.id)"
              :aria-label="`对白检测：${opt.label}`"
              @update:model-value="toggleQuoteStyle(opt.id, $event)"
            >
              <template #label
                ><code class="settingsCode">{{ opt.label }}</code></template
              >
            </AppCheckbox>
          </div>
        </div>

        <div
          v-if="showMimoPresetVoicePicker"
          class="settingsRowMain settingsRowMain--baseline"
        >
          <span class="settingsLabel short">旁白</span>
          <AppCustomSelect
            class="settingsRowControl"
            :model-value="draft.multi.narrationVoiceId"
            :display-label="narrationVoiceDisplayLabel"
            :placeholder="voiceScrollHasOptions ? '' : '暂无可用语音'"
            :fixed-top-items="selectListsEmpty"
            :scroll-items="voiceScrollItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="voiceScrollMaxHeight"
            ariaLabel="旁白语音"
            @update:model-value="patchMultiVoice({ narrationVoiceId: $event })"
          />
        </div>

        <div
          v-if="showMimoPresetVoicePicker"
          class="settingsRowMain settingsRowMain--baseline"
        >
          <span class="settingsLabel short">对白</span>
          <AppCustomSelect
            class="settingsRowControl"
            :model-value="draft.multi.dialogueVoiceId"
            :display-label="dialogueVoiceDisplayLabel"
            :placeholder="voiceScrollHasOptions ? '' : '暂无可用语音'"
            :fixed-top-items="selectListsEmpty"
            :scroll-items="voiceScrollItems"
            :fixed-bottom-items="selectListsEmpty"
            :scroll-max-height="voiceScrollMaxHeight"
            ariaLabel="对白语音"
            @update:model-value="patchMultiVoice({ dialogueVoiceId: $event })"
          />
        </div>

        <div
          v-if="showAiSpeakerRecognitionToggle"
          class="settingsRowMain settingsRowMain--baseline"
        >
          <span class="settingsLabel short">AI 识别</span>
          <SwitchToggle
            :model-value="draft.multi.aiSpeakerRecognitionEnabled"
            aria-label="AI 识别"
            @update:model-value="
              patchMultiVoice({ aiSpeakerRecognitionEnabled: $event })
            "
          />
        </div>
        <p v-if="showDialogueGenderVoices" class="settingsHint">
          朗读时根据性别自动选用男声/女声，并标注语气情绪；可在「角色卡」中为角色设置专属音色。<br />
          {{ voiceReadAiTokenUsageLine }}
          <button class="link warning voiceReadAiToken__clear" href="#" @click.prevent="onClearVoiceReadAiTokenUsage">清零</button>
        </p>

        <template v-if="showDialogueGenderVoices">
          <div
            v-if="showMimoPresetVoicePicker"
            class="settingsRowMain settingsRowMain--baseline"
          >
            <span class="settingsLabel short">男声</span>
            <AppCustomSelect
              class="settingsRowControl"
              :model-value="draft.multi.dialogueMaleVoiceId"
              :display-label="dialogueMaleVoiceDisplayLabel"
              :placeholder="voiceScrollHasOptions ? '' : '暂无可用语音'"
              :fixed-top-items="selectListsEmpty"
              :scroll-items="voiceScrollItems"
              :fixed-bottom-items="selectListsEmpty"
              :scroll-max-height="voiceScrollMaxHeight"
              ariaLabel="对白男声"
              @update:model-value="patchMultiVoice({ dialogueMaleVoiceId: $event })"
            />
          </div>
          <div
            v-if="showMimoPresetVoicePicker"
            class="settingsRowMain settingsRowMain--baseline"
          >
            <span class="settingsLabel short">女声</span>
            <AppCustomSelect
              class="settingsRowControl"
              :model-value="draft.multi.dialogueFemaleVoiceId"
              :display-label="dialogueFemaleVoiceDisplayLabel"
              :placeholder="voiceScrollHasOptions ? '' : '暂无可用语音'"
              :fixed-top-items="selectListsEmpty"
              :scroll-items="voiceScrollItems"
              :fixed-bottom-items="selectListsEmpty"
              :scroll-max-height="voiceScrollMaxHeight"
              ariaLabel="对白女声"
              @update:model-value="
                patchMultiVoice({ dialogueFemaleVoiceId: $event })
              "
            />
          </div>
        </template>
      </template>

      <div
        v-else-if="showMimoPresetVoicePicker"
        class="settingsRowMain settingsRowMain--baseline"
      >
        <span class="settingsLabel short">音色</span>
        <AppCustomSelect
          class="settingsRowControl"
          :model-value="draft.single.voiceId"
          :display-label="voiceDisplayLabel"
          :placeholder="voiceScrollHasOptions ? '' : '暂无可用音色'"
          :fixed-top-items="selectListsEmpty"
          :scroll-items="voiceScrollItems"
          :fixed-bottom-items="selectListsEmpty"
          :scroll-max-height="voiceScrollMaxHeight"
          ariaLabel="音色"
          @update:model-value="patchSingleVoice({ voiceId: $event })"
        />
      </div>

      <textarea
        v-model="previewText"
        class="settingsStretchTextarea settingsStretchTextarea--multiline"
        :rows="isMultiScheme ? 5 : 3"
        aria-label="试听文本"
      />
      <div class="voiceReadPreviewFooter">
        <button
          type="button"
          class="btn voiceReadPreviewRestoreBtn"
          @click="restoreDefaultPreviewText"
        >
          恢复默认试听内容
        </button>
        <div class="voiceReadPreviewActionsGroup">
          <p
            v-if="previewError"
            class="voiceReadPreviewError"
            role="alert"
          >
            {{ previewError }}
          </p>
          <IconButton
            v-if="previewDownload"
            class="voiceReadPreviewDownloadBtn"
            :icon-html="icons.download"
            title="保存试听音频"
            aria-label="保存试听音频"
            @click="onPreviewDownload"
          />
          <button
            type="button"
            class="btn voiceReadPreviewBtn"
            :class="[previewButtonClass]"
            :disabled="previewDisabled"
            :aria-label="isPreviewPlaying ? '停止试听' : '试听'"
            @click="onPreviewButtonClick"
          >
            {{ previewButtonLabel }}
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.voiceReadPreviewFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
}

.voiceReadPreviewRestoreBtn {
  flex-shrink: 0;
}

.voiceReadPreviewActionsGroup {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  max-width: 100%;
  min-width: 0;
}

.voiceReadPreviewError {
  flex: 0 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--danger);
  text-align: right;
}

.voiceReadPreviewDownloadBtn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}

.voiceReadPreviewBtn {
  flex-shrink: 0;
  transition:
    background 0.42s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.42s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.42s cubic-bezier(0.4, 0, 0.2, 1);
}

.voiceReadQuoteChecks {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 8px 14px;
}

.voiceReadAiToken__clear {
  margin-left: 8px;
}

.settingsStretchTextarea--multiline {
  min-height: 72px;
}

.settingsLabel--strong {
  font-weight: 600;
}

.iconOnly {
  padding: 6px;
  flex-shrink: 0;
}

.iconSvg :deep(svg) {
  width: 16px;
  height: 16px;
  display: block;
}

.iconSvg :deep(svg path) {
  fill: currentColor;
}
</style>
