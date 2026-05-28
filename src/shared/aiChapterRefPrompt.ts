/**
 * 用户可见章节跳转的唯一字面格式（系统提示 / 工具说明共用），减少模型自创 `[ch=]`、`(ch=M: N)` 等变体。
 * 约定用**全角括号**包裹，避免正文出现形如 `[...](ch=N)` 时被 Markdown 误解析为链接（方括号内不限于序号）。
 */

/** Agent 系统提示中单独成行 */
export const AI_USER_VISIBLE_CH_REF_RULE =
  "用户可见正文里的章节跳转**必须且仅能**写 `（ch=N）`：用中文全角圆括号 `（` 与 `）` 包住整段标记，中间为小写半角 `ch`、半角等号 `=`、阿拉伯数字 **N = chapterIndex（全书章节从 0 起的索引，与 ragContext / ragSearch JSON 中的 chapterIndex 一致；首章为 0）**。**多个章节须分别写多个标记**，例如 `（ch=2）（ch=5）`；**禁止**写在一个括号内如 `（ch=2, ch=5）`、**禁止** `（ch=25-26）` 范围写法、**禁止** `（ch=25…）` 在序号后同一括号内再写说明（如提及/章末/出现等，应写在标记外：`…（ch=25）提及`）。**勿用半角括号** `(ch=N)`：若前文有 Markdown 式的 `[…]` 普通文本，再紧跟半角 `(ch=…)` 易被渲染器误认为链接语法。**禁止** `[ch=N]`、`(ch=字母)`、`(ch=字母: N)` 或其它自创格式。工具返回里的章节分隔行（如「第 K 章 · …」）仅供阅读，**不要**照抄其中的数字当作 `（ch=N）` 里的 N（须用 JSON 的 chapterIndex）。";

/** 非 Agent（经典 RAG）系统提示里较短一句 */
export const AI_USER_VISIBLE_CH_REF_SHORT =
  "引用时在正文写 `（ch=N）`（全角括号 + 半角 `ch=` + 数字；**N 为 chapterIndex，从 0 起**）。多章写 `（ch=a）（ch=b）`，勿写 `（ch=a, ch=b）`、`（ch=a-b）` 或在同一括号内 `（ch=N`+说明文字+`）`。不要用半角括号 `(ch=N)`（易与前面的 `[…]` 连成 Markdown 链接误解析）、不要用方括号或其它格式。";

/** 工具 mergedMarkdown 里的章节分隔（避免出现 `[ch=`，避免模型模仿）；`chapterIndex` 从 0 起 */
export function formatAiToolChapterHeading(
  chapterIndex: number,
  chapterTitle: string,
): string {
  return `第 ${chapterIndex + 1} 章 · ${chapterTitle}`;
}
