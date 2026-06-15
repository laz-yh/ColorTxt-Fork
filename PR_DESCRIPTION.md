## feat(reader): 全局高亮词功能

### 新增

- 全局高亮词 `globalHighlightWords`，跨文件匹配所有电子书
- 高亮词列表每条新增 SwitchToggle 开关，切换全局/文件级状态
  - **打开**：文件级词 → 全局词，所有电子书生效
  - **关闭**：全局词 → 文件级词，仅当前文件生效
- 显示逻辑：全局词优先，文件级词补充，同名词自动去重
- Monarch tokenizer 合并全局词与文件级词统一匹配

### 数据管理

| 维度 | 存储 Key | 结构 |
|------|----------|------|
| 全局高亮词 | `colorTxt.ui.settings` → `globalHighlightWords` | `Record<string, string[]>`，按色值索引组织 |
| 文件级高亮词 | `colorTxt.file.meta` → `highlightWordsByIndex` | 不变，每本书独立 |

### 持久化

- **加载校验**：索引必须为合法非负整数、词长 ≤100、自动去重、剔除空数组
- **保存策略**：仅写入非空数据，空对象不写磁盘

### 影响文件

- `src/renderer/src/App.vue` — 状态管理、事件处理
- `src/renderer/src/components/HighlightListPanel.vue` — UI 展示 + SwitchToggle
- `src/renderer/src/components/ReaderMain.vue` — Monarch tokenizer 合并逻辑
- `src/renderer/src/components/ReaderSidebar.vue` — 事件透传 + 类型对齐
- `src/renderer/src/composables/useAppPersistence.ts` — 持久化加载/保存
- `src/renderer/src/stores/cacheStore.ts` — 类型定义 + 数据校验

### 变更统计

```
 6 files changed, 284 insertions(+), 21 deletions(-)
```
