import { computed, ref } from "vue";
import type { CustomSelectItem } from "../components/AppCustomSelect.vue";
import type { SidebarFileItem } from "./useReaderSidebarLists";
import type { FileCategoryDefinition } from "../constants/fileCategories";
import {
  DEFAULT_FILE_SORT,
  FILE_CATEGORY_ACTION_MANAGE,
  FILE_CATEGORY_FILTER_ALL,
  FILE_CATEGORY_FILTER_UNCATEGORIZED,
  UNCATEGORIZED_LIST_BORDER_COLOR,
  type FileSortMode,
} from "../constants/fileCategories";
import { icons } from "../icons";

export type FileListCategorySortProps = Readonly<{
  files: SidebarFileItem[];
  fileCategory: string;
  fileSort: FileSortMode;
  fileCategoryCatalog: FileCategoryDefinition[];
}>;

export type FileListCategorySortEmit = {
  (e: "update:fileCategory", value: string): void;
  (e: "update:fileSort", value: FileSortMode): void;
  (e: "persistUi"): void;
};

export function useFileListCategorySort(
  props: FileListCategorySortProps,
  emit: FileListCategorySortEmit,
) {
  const manageModalOpen = ref(false);

  const categoryMenuCounts = computed(() => {
    const files = props.files;
    const all = files.length;
    let uncategorized = 0;
    const byName: Record<string, number> = {};
    for (const c of props.fileCategoryCatalog) {
      byName[c.name] = 0;
    }
    for (const f of files) {
      const n = (f.category ?? "").trim();
      if (!n) {
        uncategorized++;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(byName, n)) {
        byName[n] = (byName[n] ?? 0) + 1;
      }
    }
    return { all, uncategorized, byName };
  });

  const categoryFixedTop = computed((): CustomSelectItem[] => {
    const m = categoryMenuCounts.value;
    return [
      {
        kind: "item",
        id: FILE_CATEGORY_FILTER_ALL,
        label: "全部",
        skipCategoryMark: true,
        labelSuffix: `(${m.all})`,
      },
      {
        kind: "item",
        id: FILE_CATEGORY_FILTER_UNCATEGORIZED,
        label: "未分类",
        skipCategoryMark: true,
        labelSuffix: `(${m.uncategorized})`,
      },
      { kind: "divider" },
    ];
  });

  const categoryScrollItems = computed((): CustomSelectItem[] => {
    const m = categoryMenuCounts.value;
    const out: CustomSelectItem[] = [];
    for (const c of props.fileCategoryCatalog) {
      out.push({
        kind: "item",
        id: c.name,
        label: c.name,
        borderColor: c.color,
        labelSuffix: `(${m.byName[c.name] ?? 0})`,
      });
    }
    return out;
  });

  const categoryFixedBottom = computed((): CustomSelectItem[] => [
    { kind: "divider" },
    {
      kind: "item",
      id: FILE_CATEGORY_ACTION_MANAGE,
      label: "分类管理",
      actionOnly: true,
    },
  ]);

  const categoryTriggerLabel = computed(() => {
    const v = props.fileCategory;
    if (v === FILE_CATEGORY_FILTER_ALL) return "全部";
    if (v === FILE_CATEGORY_FILTER_UNCATEGORIZED) return "未分类";
    return v;
  });

  const categoryTriggerSuffix = computed(() => {
    // const m = categoryMenuCounts.value;
    // const v = props.fileCategory;
    // const n =
    //   v === FILE_CATEGORY_FILTER_ALL
    //     ? m.all
    //     : v === FILE_CATEGORY_FILTER_UNCATEGORIZED
    //       ? m.uncategorized
    //       : (m.byName[v] ?? 0);
    // return `(${n})`;
    return "";
  });

  const categoryTriggerMarkColor = computed(() => {
    const v = props.fileCategory;
    if (
      v === FILE_CATEGORY_FILTER_ALL ||
      v === FILE_CATEGORY_FILTER_UNCATEGORIZED
    ) {
      return undefined;
    }
    const hit = props.fileCategoryCatalog.find((x) => x.name === v);
    if (hit) return hit.color;
    return UNCATEGORIZED_LIST_BORDER_COLOR;
  });

  const SORT_LABELS: Record<FileSortMode, string> = {
    nameAsc: "文件名",
    nameDesc: "文件名",
    pathAsc: "文件路径",
    pathDesc: "文件路径",
    sizeAsc: "文件大小",
    sizeDesc: "文件大小",
    progressAsc: "阅读进度",
    progressDesc: "阅读进度",
    lastReadAtAsc: "打开时间",
    lastReadAtDesc: "打开时间",
    addedAtAsc: "添加时间",
    addedAtDesc: "添加时间",
  };

  const sortScrollItems = computed((): CustomSelectItem[] => {
    const modes: FileSortMode[] = [
      "nameAsc",
      "nameDesc",
      "pathAsc",
      "pathDesc",
      "sizeAsc",
      "sizeDesc",
      "progressAsc",
      "progressDesc",
      "lastReadAtAsc",
      "lastReadAtDesc",
      "addedAtAsc",
      "addedAtDesc",
    ];
    return modes.map((m) => ({
      kind: "item" as const,
      id: m,
      label: SORT_LABELS[m],
      prefixHtml: /Asc$/.test(m) ? icons.asc : icons.desc,
    }));
  });

  const sortDisplayLabel = computed(() => {
    const m = props.fileSort ?? DEFAULT_FILE_SORT;
    return SORT_LABELS[m] ?? "文件名";
  });

  const sortTriggerPrefixHtml = computed(() =>
    /Asc$/.test(props.fileSort ?? DEFAULT_FILE_SORT) ? icons.asc : icons.desc,
  );

  function onCategorySelect(id: string) {
    emit("update:fileCategory", id);
    emit("persistUi");
  }

  function onCategoryAction(id: string) {
    if (id === FILE_CATEGORY_ACTION_MANAGE) {
      manageModalOpen.value = true;
    }
  }

  function onSortSelect(id: string) {
    if (id === props.fileSort) return;
    emit("update:fileSort", id as FileSortMode);
    emit("persistUi");
  }

  return {
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
  };
}
