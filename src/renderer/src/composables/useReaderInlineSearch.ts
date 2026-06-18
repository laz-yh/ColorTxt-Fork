import type { ShallowRef } from "vue";
import * as monaco from "monaco-editor";

type MatchShape = { lineNumber: number; startColumn: number; endColumn: number };

export function useReaderInlineSearch(deps: {
  editor: ShallowRef<monaco.editor.IStandaloneCodeEditor | null>;
  model: ShallowRef<monaco.editor.ITextModel | null>;
  inlineSearchDecorationsCollection: ShallowRef<monaco.editor.IEditorDecorationsCollection | null>;
  beginProgrammaticScroll: () => void;
  monacoScrollType: (smooth: boolean) => monaco.editor.ScrollType;
  suppressHighlightTipForProgrammaticSelection: () => void;
  /** 清除所有装饰器（包括 Ctrl+F 的） */
  onClearAllDecorations?: () => void;
}) {
  let inlineSearchQuery = "";
  let inlineSearchCaseSensitive = false;
  let inlineSearchWholeWord = false;
  let inlineSearchUseRegex = false;
  let inlineSearchCurrentMatch: MatchShape | null = null;
  /** Ctrl+F 打开时关闭内联搜索装饰器，需要时才恢复 */
  let inlineSearchDecorationsDisabled = false;

  function isWordChar(ch: string): boolean {
    return /[0-9A-Za-z_]/.test(ch);
  }

  function isWholeWordRange(text: string, start: number, end: number): boolean {
    const before = start > 0 ? text[start - 1] : "";
    const after = end < text.length ? text[end] : "";
    const leftOk = before === "" || !isWordChar(before);
    const rightOk = after === "" || !isWordChar(after);
    return leftOk && rightOk;
  }

  function sameInlineSearchMatch(a: MatchShape, b: monaco.Range) {
    return (
      a.lineNumber === b.startLineNumber &&
      a.startColumn === b.startColumn &&
      a.endColumn === b.endColumn
    );
  }

  function findInlineSearchMatches(query: string) {
    const m = deps.model.value;
    if (!m) return [] as monaco.editor.FindMatch[];
    let matches = m.findMatches(
      query,
      false,
      inlineSearchUseRegex,
      inlineSearchCaseSensitive,
      null,
      false,
    );
    if (inlineSearchWholeWord) {
      matches = matches.filter((it) => {
        const lineText = m.getLineContent(it.range.startLineNumber);
        const start = Math.max(0, it.range.startColumn - 1);
        const end = Math.max(start, it.range.endColumn - 1);
        return isWholeWordRange(lineText, start, end);
      });
    }
    return matches;
  }

  function applyInlineSearchDecorations() {
    const m = deps.model.value;
    const collection = deps.inlineSearchDecorationsCollection.value;
    if (!m || !collection) return;
    if (inlineSearchDecorationsDisabled) return;
    const query = inlineSearchQuery.trim();
    if (!query) {
      collection.clear();
      return;
    }
    const matches = findInlineSearchMatches(query);
    if (matches.length === 0) {
      collection.clear();
      return;
    }
    let currentMatchIndex = -1;
    if (inlineSearchCurrentMatch != null) {
      currentMatchIndex = matches.findIndex((it) =>
        sameInlineSearchMatch(inlineSearchCurrentMatch!, it.range),
      );
    }
    if (currentMatchIndex < 0) currentMatchIndex = 0;
    const currentRange = matches[currentMatchIndex]!.range;
    const decorations: monaco.editor.IModelDeltaDecoration[] = matches.map(
      (it, idx) => ({
        range: it.range,
        options: {
          inlineClassName:
            idx === currentMatchIndex
              ? "readerInlineSearchCurrentMatch"
              : "readerInlineSearchMatch",
          /** 在概览尺/滚动条上显示匹配位置指示条，颜色同 Ctrl+F */
          overviewRuler: {
            color: idx === currentMatchIndex ? "#f7dc6f" : "#a8ac94",
            position: monaco.editor.OverviewRulerLane.Center,
          },
        },
      }),
    );
    decorations.push({
      range: new monaco.Range(
        currentRange.startLineNumber,
        1,
        currentRange.startLineNumber,
        m.getLineMaxColumn(currentRange.startLineNumber),
      ),
      options: {
        isWholeLine: true,
        className: "readerInlineSearchCurrentLine",
        linesDecorationsClassName: "readerInlineSearchCurrentLineDecor",
      },
    });
    collection.set(decorations);
  }

  function setInlineSearchState(
    query: string,
    currentMatch?: MatchShape | null,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
    },
  ) {
    inlineSearchQuery = query.trim();
    inlineSearchCaseSensitive = options?.caseSensitive === true;
    inlineSearchWholeWord = options?.wholeWord === true;
    inlineSearchUseRegex = options?.useRegex === true;
    if (
      currentMatch &&
      Number.isFinite(currentMatch.lineNumber) &&
      Number.isFinite(currentMatch.startColumn) &&
      Number.isFinite(currentMatch.endColumn)
    ) {
      inlineSearchCurrentMatch = {
        lineNumber: Math.max(1, Math.floor(currentMatch.lineNumber)),
        startColumn: Math.max(1, Math.floor(currentMatch.startColumn)),
        endColumn: Math.max(
          1,
          Math.floor(Math.max(currentMatch.startColumn, currentMatch.endColumn)),
        ),
      };
    } else {
      inlineSearchCurrentMatch = null;
    }
    applyInlineSearchDecorations();
  }

  function clearInlineSearchState() {
    inlineSearchQuery = "";
    inlineSearchCaseSensitive = false;
    inlineSearchWholeWord = false;
    inlineSearchUseRegex = false;
    inlineSearchCurrentMatch = null;
    deps.inlineSearchDecorationsCollection.value?.clear();
  }

  /** 仅清除装饰器并禁用（用于 Ctrl+F 打开时避免颜色共存） */
  function clearInlineSearchDecorations() {
    inlineSearchDecorationsDisabled = true;
    deps.inlineSearchDecorationsCollection.value?.clear();
  }

  function jumpToSearchMatchCentered(
    lineNumber: number,
    startColumn: number,
    endColumn: number,
    smooth = true,
  ) {
    const e = deps.editor.value;
    const m = deps.model.value;
    if (!e || !m) return;
    deps.beginProgrammaticScroll();
    const lineCount = m.getLineCount();
    const line = Math.max(
      1,
      Math.min(Math.floor(lineNumber), Math.max(1, lineCount)),
    );
    const maxCol = Math.max(1, m.getLineMaxColumn(line));
    const start = Math.max(1, Math.min(Math.floor(startColumn), maxCol));
    const end = Math.max(start, Math.min(Math.floor(endColumn), maxCol));
    const range = new monaco.Range(line, start, line, end);
    const selection = new monaco.Selection(line, start, line, end);
    const scrollType = deps.monacoScrollType(smooth);
    e.layout();
    deps.suppressHighlightTipForProgrammaticSelection();
    e.setPosition({ lineNumber: line, column: start });
    e.setSelection(selection);
    e.revealRangeInCenter(range, scrollType);
    const editorWithTopForPos = e as monaco.editor.IStandaloneCodeEditor & {
      getTopForPosition?: (lineNumber: number, column?: number) => number;
    };
    if (typeof editorWithTopForPos.getTopForPosition === "function") {
      const posTop = editorWithTopForPos.getTopForPosition(line, start);
      const vh = e.getLayoutInfo().height;
      const lineHeightPx = e.getOption(monaco.editor.EditorOption.lineHeight);
      const targetTop = Math.max(0, posTop - Math.floor(vh / 2) + lineHeightPx / 2);
      e.setScrollTop(targetTop, scrollType);
    }
    e.focus();
  }

  function jumpToNextInlineSearchMatch(
    query: string,
    options?: {
      caseSensitive?: boolean;
      wholeWord?: boolean;
      useRegex?: boolean;
      smooth?: boolean;
    },
  ): boolean {
    const e = deps.editor.value;
    if (!e) return false;
    const q = query.trim();
    if (!q) {
      clearInlineSearchState();
      return false;
    }
    /** 启用内联搜索装饰器（用户主动点击高亮词） */
    inlineSearchDecorationsDisabled = false;
    inlineSearchQuery = q;
    inlineSearchCaseSensitive = options?.caseSensitive === true;
    inlineSearchWholeWord = options?.wholeWord === true;
    inlineSearchUseRegex = options?.useRegex === true;
    const matches = findInlineSearchMatches(q);
    if (matches.length === 0) {
      clearInlineSearchState();
      return false;
    }
    const pos = e.getPosition() ?? { lineNumber: 1, column: 1 };
    let idx = matches.findIndex((it) => {
      const r = it.range;
      if (r.startLineNumber > pos.lineNumber) return true;
      if (r.startLineNumber < pos.lineNumber) return false;
      return r.startColumn > pos.column;
    });
    if (idx < 0) idx = 0;
    const target = matches[idx]!.range;
    inlineSearchCurrentMatch = {
      lineNumber: target.startLineNumber,
      startColumn: target.startColumn,
      endColumn: target.endColumn,
    };
    /** 先清除内联搜索装饰器确保干净 */
    deps.inlineSearchDecorationsCollection.value?.clear();
    deps.onClearAllDecorations?.();
    applyInlineSearchDecorations();
    jumpToSearchMatchCentered(
      target.startLineNumber,
      target.startColumn,
      target.endColumn,
      options?.smooth !== false,
    );
    return true;
  }

  function hasInlineSearchQuery(): boolean {
    return inlineSearchQuery.trim().length > 0;
  }

  return {
    applyInlineSearchDecorations,
    setInlineSearchState,
    clearInlineSearchState,
    clearInlineSearchDecorations,
    jumpToSearchMatchCentered,
    jumpToNextInlineSearchMatch,
    hasInlineSearchQuery,
  };
}
