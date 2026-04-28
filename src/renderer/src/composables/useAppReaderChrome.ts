import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import type ReaderMain from "../components/ReaderMain.vue";
import {
  FULLSCREEN_BOTTOM_EDGE_PX,
  FULLSCREEN_LEFT_EDGE_PX,
  FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX,
  FULLSCREEN_TOP_EDGE_PX,
  SIDEBAR_MIN_READER_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../constants/appUi";
import { nodeIsUnderFullscreenHeaderFloat } from "../utils/fullscreenHeaderFloat";
import { nodeIsUnderFullscreenSidebarFloat } from "../utils/fullscreenSidebarFloat";

/** 全屏下鼠标静止超过该时间后隐藏光标 */
const FULLSCREEN_CURSOR_HIDE_IDLE_MS = 2000;

/** 过渡结束后再开始算「可见时长」，避免 macOS 全屏动画期间就把计时耗完 */
const FULLSCREEN_TIP_MS_BEFORE_FADE = 1000;
const FULLSCREEN_TIP_FADE_MS = 250;

function fullscreenTipPostTransitionDelayMs(): number {
  if (typeof navigator === "undefined") return 120;
  const p = navigator.platform;
  if (p === "MacIntel" || p === "MacARM") return 480;
  if (/Mac OS X/i.test(navigator.userAgent)) return 480;
  return 120;
}

type ReaderRef = Ref<InstanceType<typeof ReaderMain> | null>;

/** 从 `start` 沿 DOM / ShadowRoot.host 向上，判断是否落在 `panel` 子树内（与 `useAppFullscreenReaderLayout` 侧栏判定一致）。 */
function nodeIsUnderFullscreenPanel(panel: HTMLElement, start: Node | null) {
  let cur: Node | null = start;
  while (cur) {
    if (cur === panel) return true;
    if (cur instanceof Element && panel.contains(cur)) return true;
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) cur = root.host;
    else cur = cur.parentNode;
  }
  return false;
}

/**
 * 全屏浮动 UI 统一模型：
 * - `document` mousemove：仅在对应边缘「感应区」且面板未显示时唤起；
 * - 面板根节点 `@mouseleave`：全屏且已显示时收起（与真实命中区域一致）；
 * - `.layout` `mousedown`：全屏时收起顶栏/底栏/侧栏（点击落在已展开侧栏内除外）。
 */
export function useAppReaderChrome(deps: {
  readerRef: ReaderRef;
  /** 全屏侧栏文件列表：Teleport 弹层是否打开；为真时 `mouseleave` 不收起侧栏，关闭后再按指针位置判断 */
  fullscreenFileListPopoversOpen: Ref<boolean>;
  /** 全屏下临时禁用侧栏左缘感应唤起（如设置/配色弹框打开期间） */
  suppressFullscreenSidebarHover?: Ref<boolean>;
}) {
  const isFullscreenView = ref(false);
  const showFullscreenTip = ref(false);
  const fullscreenTipFading = ref(false);
  let tipFadeTimer: ReturnType<typeof setTimeout> | null = null;
  let tipHideTimer: ReturnType<typeof setTimeout> | null = null;
  let tipArmDelayTimer: ReturnType<typeof setTimeout> | null = null;
  const showFullscreenHeader = ref(false);
  const fullscreenHeaderOverlayRef = ref<HTMLElement | null>(null);
  const showFullscreenFooter = ref(false);
  const fullscreenFooterOverlayRef = ref<HTMLElement | null>(null);
  /** 全屏时鼠标靠近左边缘显示的浮动章节侧栏 */
  const showFullscreenSidebar = ref(false);
  const fullscreenSidebarOverlayRef = ref<HTMLElement | null>(null);

  /** 供「文件列表浮层关闭后」判断是否应收起全屏侧栏（与 `mousemove` 同步） */
  const lastFullscreenPointerClientX = ref(0);
  const lastFullscreenPointerClientY = ref(0);

  const sidebarWidth = ref(270);
  /** 全屏专用侧栏宽度；非全屏为 null（退出全屏时销毁，窗口态仍用 sidebarWidth） */
  const fullscreenSidebarWidth = ref<number | null>(null);
  const resizingSidebar = ref(false);

  const sidebarWidthForLayout = computed(() => {
    if (isFullscreenView.value && fullscreenSidebarWidth.value != null) {
      return fullscreenSidebarWidth.value;
    }
    return sidebarWidth.value;
  });

  const fullscreenCursorHidden = ref(false);
  let fullscreenCursorHideTimer: ReturnType<typeof setTimeout> | null = null;

  /** 顶栏 / 侧栏 / 底栏任一展开时不自动隐藏光标 */
  function anyFullscreenBarVisible(): boolean {
    return (
      showFullscreenHeader.value ||
      showFullscreenFooter.value ||
      showFullscreenSidebar.value
    );
  }

  function clearFullscreenCursorHideTimer() {
    if (fullscreenCursorHideTimer) {
      clearTimeout(fullscreenCursorHideTimer);
      fullscreenCursorHideTimer = null;
    }
  }

  function armFullscreenCursorHideTimer() {
    clearFullscreenCursorHideTimer();
    if (
      !isFullscreenView.value ||
      resizingSidebar.value ||
      anyFullscreenBarVisible()
    ) {
      return;
    }
    fullscreenCursorHideTimer = setTimeout(() => {
      fullscreenCursorHideTimer = null;
      fullscreenCursorHidden.value = true;
    }, FULLSCREEN_CURSOR_HIDE_IDLE_MS);
  }

  /** 全屏下指针移动时调用：显示光标并重新开始空闲计时 */
  function bumpFullscreenCursorIdle() {
    if (!isFullscreenView.value || resizingSidebar.value) return;
    fullscreenCursorHidden.value = false;
    armFullscreenCursorHideTimer();
  }

  watch(
    () =>
      [
        isFullscreenView.value,
        resizingSidebar.value,
        showFullscreenHeader.value,
        showFullscreenFooter.value,
        showFullscreenSidebar.value,
      ] as const,
    ([fs, rs, header, footer, sidebar]) => {
      if (!fs) {
        clearFullscreenCursorHideTimer();
        fullscreenCursorHidden.value = false;
        return;
      }
      if (rs || header || footer || sidebar) {
        clearFullscreenCursorHideTimer();
        fullscreenCursorHidden.value = false;
        return;
      }
      armFullscreenCursorHideTimer();
    },
  );

  function clearFullscreenTipTimers() {
    if (tipFadeTimer) clearTimeout(tipFadeTimer);
    if (tipHideTimer) clearTimeout(tipHideTimer);
    if (tipArmDelayTimer) clearTimeout(tipArmDelayTimer);
    tipFadeTimer = null;
    tipHideTimer = null;
    tipArmDelayTimer = null;
  }

  function armFullscreenTipHideTimers() {
    if (!showFullscreenTip.value || !isFullscreenView.value) return;
    clearFullscreenTipTimers();
    fullscreenTipFading.value = false;
    tipFadeTimer = setTimeout(() => {
      fullscreenTipFading.value = true;
    }, FULLSCREEN_TIP_MS_BEFORE_FADE);
    tipHideTimer = setTimeout(() => {
      showFullscreenTip.value = false;
      fullscreenTipFading.value = false;
    }, FULLSCREEN_TIP_MS_BEFORE_FADE + FULLSCREEN_TIP_FADE_MS);
  }

  async function enterOrExitFullscreenView() {
    if (!isFullscreenView.value) {
      isFullscreenView.value = true;
      showFullscreenTip.value = true;
      fullscreenTipFading.value = false;
      clearFullscreenTipTimers();

      try {
        await window.colorTxt.setFullscreen(true);
        tipArmDelayTimer = setTimeout(() => {
          tipArmDelayTimer = null;
          armFullscreenTipHideTimers();
        }, fullscreenTipPostTransitionDelayMs());
      } catch {
        isFullscreenView.value = false;
        showFullscreenTip.value = false;
        fullscreenTipFading.value = false;
        clearFullscreenTipTimers();
      }
      return;
    }

    try {
      await window.colorTxt.setFullscreen(false);
    } catch {
      // ignore; main-process fullscreen event will handle UI sync if possible
    }
  }

  function getSidebarMaxWidth(): number {
    return Math.max(0, window.innerWidth - SIDEBAR_MIN_READER_WIDTH);
  }

  function getSidebarMinWidth(): number {
    return Math.min(SIDEBAR_MIN_WIDTH, getSidebarMaxWidth());
  }

  function clampSidebarWidthToViewport(): void {
    const minW = getSidebarMinWidth();
    const maxW = getSidebarMaxWidth();
    const clamp = (w: number) => Math.min(maxW, Math.max(minW, w));
    sidebarWidth.value = clamp(sidebarWidth.value);
    if (isFullscreenView.value && fullscreenSidebarWidth.value != null) {
      fullscreenSidebarWidth.value = clamp(fullscreenSidebarWidth.value);
    }
  }

  watch(isFullscreenView, (fs) => {
    if (fs) {
      const minW = getSidebarMinWidth();
      const maxW = getSidebarMaxWidth();
      fullscreenSidebarWidth.value = Math.min(
        maxW,
        Math.max(minW, sidebarWidth.value),
      );
    } else {
      fullscreenSidebarWidth.value = null;
    }
  });

  function startResizeSidebar(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    resizingSidebar.value = true;
  }

  function endSidebarResize() {
    resizingSidebar.value = false;
  }

  /** 另外两个浮动层未显示时，才允许通过边缘悬停打开当前层 */
  function canShowFullscreenPanel(
    which: "header" | "sidebar" | "footer",
  ): boolean {
    if (which === "header") {
      return !showFullscreenSidebar.value && !showFullscreenFooter.value;
    }
    if (which === "sidebar") {
      return !showFullscreenHeader.value && !showFullscreenFooter.value;
    }
    return !showFullscreenHeader.value && !showFullscreenSidebar.value;
  }

  /** 全屏左缘感应：仅负责唤起。收起由侧栏容器 @mouseleave 处理。 */
  function recordFullscreenPointer(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    lastFullscreenPointerClientX.value = ev.clientX;
    lastFullscreenPointerClientY.value = ev.clientY;
  }

  function updateFullscreenSidebarHover(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    if (deps.suppressFullscreenSidebarHover?.value) return;
    if (showFullscreenSidebar.value) return;
    const x = ev.clientX;
    if (x <= FULLSCREEN_LEFT_EDGE_PX && canShowFullscreenPanel("sidebar")) {
      showFullscreenSidebar.value = true;
    }
  }

  /** 指针既不在侧栏子树也不在侧栏 Teleport 白名单上时收起全屏浮动侧栏 */
  function tryCollapseFullscreenSidebarFromPointer(
    clientX: number,
    clientY: number,
  ) {
    if (!isFullscreenView.value || !showFullscreenSidebar.value) return;
    if (resizingSidebar.value) return;
    if (deps.fullscreenFileListPopoversOpen.value) return;
    const top = document.elementFromPoint(clientX, clientY);
    if (top && nodeIsUnderFullscreenSidebarFloat(top)) return;
    const sidebar = fullscreenSidebarOverlayRef.value;
    if (sidebar && top && nodeIsUnderFullscreenPanel(sidebar, top)) return;
    showFullscreenSidebar.value = false;
  }

  function onFullscreenSidebarMouseLeave(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    if (resizingSidebar.value) return;
    if (deps.fullscreenFileListPopoversOpen.value) return;
    const rt = ev.relatedTarget;
    if (rt instanceof Node && nodeIsUnderFullscreenSidebarFloat(rt)) return;
    const { clientX, clientY } = ev;
    requestAnimationFrame(() => {
      if (!isFullscreenView.value || !showFullscreenSidebar.value) return;
      if (deps.fullscreenFileListPopoversOpen.value) return;
      tryCollapseFullscreenSidebarFromPointer(clientX, clientY);
    });
  }

  watch(
    () => deps.fullscreenFileListPopoversOpen.value,
    (open, wasOpen) => {
      if (wasOpen !== true || open !== false) return;
      if (!isFullscreenView.value || !showFullscreenSidebar.value) return;
      requestAnimationFrame(() => {
        if (deps.fullscreenFileListPopoversOpen.value) return;
        tryCollapseFullscreenSidebarFromPointer(
          lastFullscreenPointerClientX.value,
          lastFullscreenPointerClientY.value,
        );
      });
    },
  );

  /** 收起全屏顶栏并关闭已显示的 Monaco 查找栏（不经过 `watch`，避免与 `onToggleFind` 同 tick 竞态） */
  function collapseFullscreenHeaderAndCloseFindIfRevealed() {
    if (!isFullscreenView.value) return;
    if (!showFullscreenHeader.value) return;
    showFullscreenHeader.value = false;
    deps.readerRef.value?.closeFindWidgetIfRevealed?.();
  }

  /** 指针既不在顶栏子树也不在顶栏相关 AppModal 蒙层上时收起全屏浮动顶栏 */
  function tryCollapseFullscreenHeaderFromPointer(
    clientX: number,
    clientY: number,
  ) {
    if (!isFullscreenView.value || !showFullscreenHeader.value) return;
    const top = document.elementFromPoint(clientX, clientY);
    if (top && nodeIsUnderFullscreenHeaderFloat(top)) return;
    const header = fullscreenHeaderOverlayRef.value;
    if (header && top && nodeIsUnderFullscreenPanel(header, top)) return;
    collapseFullscreenHeaderAndCloseFindIfRevealed();
  }

  /** 全屏顶缘感应区：仅负责唤起。收起由顶栏容器 @mouseleave 处理（与真实命中区域一致）。 */
  function updateFullscreenHeaderHover(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    if (deps.readerRef.value?.isFindWidgetRevealed?.()) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
      return;
    }
    if (showFullscreenHeader.value) return;

    const x = ev.clientX;
    const y = ev.clientY;
    const inRightScrollbarGutter =
      x >= window.innerWidth - FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX;
    if (inRightScrollbarGutter) return;
    if (y <= FULLSCREEN_TOP_EDGE_PX && canShowFullscreenPanel("header")) {
      showFullscreenHeader.value = true;
    }
  }

  function onFullscreenHeaderMouseLeave(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    const rt = ev.relatedTarget;
    if (rt instanceof Node && nodeIsUnderFullscreenHeaderFloat(rt)) return;
    const { clientX, clientY } = ev;
    requestAnimationFrame(() => {
      if (!isFullscreenView.value || !showFullscreenHeader.value) return;
      tryCollapseFullscreenHeaderFromPointer(clientX, clientY);
    });
  }

  /** 全屏底缘感应：仅负责唤起。收起由底栏容器 @mouseleave 处理。 */
  function updateFullscreenFooterHover(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    if (showFullscreenFooter.value) return;
    const vh = window.innerHeight;
    const y = ev.clientY;
    const inRightScrollbarGutter =
      ev.clientX >= window.innerWidth - FULLSCREEN_RIGHT_SCROLLBAR_GUTTER_PX;
    if (inRightScrollbarGutter) return;
    if (y >= vh - FULLSCREEN_BOTTOM_EDGE_PX && canShowFullscreenPanel("footer")) {
      showFullscreenFooter.value = true;
    }
  }

  function onFullscreenFooterMouseLeave() {
    if (!isFullscreenView.value) return;
    showFullscreenFooter.value = false;
  }

  /**
   * 全屏下在 `.layout` 上按下指针时收起浮动顶栏/底栏/侧栏。
   * 顶栏、底栏不在 layout 子树内，能收到该事件即表示未点在栏上；
   * 侧栏在 layout 内，若当前侧栏展开且点在侧栏面板上则不收起（避免误关）。
   */
  function dismissFullscreenPanelsOnLayoutPointerDown(ev: MouseEvent) {
    if (!isFullscreenView.value) return;
    const raw = ev.target;
    if (!(raw instanceof Node)) return;
    const sidebar = fullscreenSidebarOverlayRef.value;
    if (
      showFullscreenSidebar.value &&
      sidebar &&
      (nodeIsUnderFullscreenPanel(sidebar, raw) ||
        nodeIsUnderFullscreenSidebarFloat(raw))
    ) {
      return;
    }
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
  }

  /** 主进程通知退出全屏时，与 enterOrExitFullscreenView 的提示计时器对齐清理 */
  function dismissFullscreenChromeForNativeExit() {
    showFullscreenTip.value = false;
    fullscreenTipFading.value = false;
    if (showFullscreenHeader.value) {
      collapseFullscreenHeaderAndCloseFindIfRevealed();
    }
    showFullscreenFooter.value = false;
    showFullscreenSidebar.value = false;
    clearFullscreenTipTimers();
  }

  onBeforeUnmount(() => {
    clearFullscreenTipTimers();
    clearFullscreenCursorHideTimer();
  });

  return {
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
    endSidebarResize,
    enterOrExitFullscreenView,
    getSidebarMaxWidth,
    getSidebarMinWidth,
    clampSidebarWidthToViewport,
    startResizeSidebar,
    updateFullscreenSidebarHover,
    onFullscreenSidebarMouseLeave,
    updateFullscreenHeaderHover,
    onFullscreenHeaderMouseLeave,
    updateFullscreenFooterHover,
    onFullscreenFooterMouseLeave,
    dismissFullscreenPanelsOnLayoutPointerDown,
    dismissFullscreenChromeForNativeExit,
    fullscreenCursorHidden,
    bumpFullscreenCursorIdle,
    recordFullscreenPointer,
  };
}
