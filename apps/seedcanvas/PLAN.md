# SeedCanvas — Implementation Plan

## Context

SeedCanvas 是 seedkit-ai monorepo 新增的桌面端无限画布应用。当前 monorepo 已有：
- `packages/@seedkit-ai/ai-sdk-provider` — AI SDK v6 provider（Seed 2.0 / VolcEngine ARK）
- `packages/@seedkit-ai/tools` — web search/fetch 工具库
- `apps/seedcode` — CLI 编码助手
- Build infra: pnpm workspaces + turbo + tsup

本计划分 4 个 Phase 渐进实施。

---

## Phase 1：骨架 + 空画布 ✅ 已完成

### 交付物

```
apps/seedcanvas/
├── PRD.md
├── PLAN.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx                    # React 19 StrictMode 入口
│   ├── App.tsx                     # flex 布局：Sidebar + Canvas
│   ├── App.css                     # Tailwind v4 @import + 全屏 reset
│   ├── vite-env.d.ts
│   ├── canvas/
│   │   ├── Canvas.tsx              # ReactFlow + Background(dots) + MiniMap + Controls
│   │   ├── store.ts                # Zustand: applyNodeChanges/applyEdgeChanges/addEdge
│   │   ├── types.ts                # CanvasNode, CanvasEdge, CanvasFile, 节点数据类型
│   │   └── nodes/
│   │       └── index.ts            # 空 nodeTypes 注册表（Phase 2 扩展）
│   ├── sidebar/
│   │   └── Sidebar.tsx             # 占位 UI
│   ├── project/
│   │   └── types.ts                # ProjectManifest 类型
│   └── lib/
│       └── fs.ts                   # Tauri FS 封装占位（Phase 2）
├── src-tauri/
│   ├── Cargo.toml                  # tauri 2.10 + tauri-plugin-fs 2.4
│   ├── tauri.conf.json             # 1280×800, "SeedCanvas", CSP
│   ├── capabilities/default.json   # core:default + fs:default
│   ├── build.rs
│   ├── icons/                      # 完整图标集（icns/ico/png）
│   └── src/
│       ├── main.rs
│       └── lib.rs                  # tauri_plugin_fs::init()
```

### 实际技术栈版本

| 依赖 | 版本 |
|------|------|
| Tauri | 2.10.2 |
| tauri-plugin-fs | 2.4.5 |
| tauri-plugin-dialog | 2.x |
| React | 19.x |
| @xyflow/react | 12.x |
| Zustand | 5.x |
| Tailwind CSS | 4.x (`@tailwindcss/vite` plugin) |
| shadcn/ui | Radix-based 组件库 |
| Biome | linter + formatter |
| Vite | 6.4.1 |
| TypeScript | 5.x |

### 实施备注

- **Tailwind v4** 不需要 `tailwind.config.ts` 和 `postcss.config.js`，使用 `@tailwindcss/vite` 插件 + CSS `@import "tailwindcss"`
- **tsconfig 简化**：删除了 `tsconfig.node.json` 项目引用（`composite` + `noEmit` 冲突），合并为单 tsconfig
- **MCP Filesystem Server 不需要**：`@tauri-apps/plugin-fs` 已覆盖文件访问需求，AI Agent 的 file tools 直接走 Tauri IPC，无需额外 Node.js 子进程
- **DMG 打包**：debug 模式下 DMG 签名会失败，不影响开发（.app 正常生成）

### 验证结果

- [x] `tsc --noEmit` 类型检查通过
- [x] `vite build` 成功（196 modules）
- [x] `cargo check` Rust 编译通过
- [x] `tauri build --debug` 生成 SeedCanvas.app
- [x] `pnpm tauri dev` 启动桌面窗口

---

## Phase 2：节点 CRUD + 持久化 ✅ 已完成

### 交付物

```
apps/seedcanvas/
├── biome.json                          # Biome linter/formatter 配置
├── components.json                     # shadcn/ui 配置
├── src/
│   ├── App.tsx                         # 条件路由：projectId ? Canvas : StartPage + auto-save 生命周期
│   ├── canvas/
│   │   ├── Canvas.tsx                  # ReactFlowProvider + CanvasInner（context menu / drag-drop / viewport）
│   │   ├── ContextMenu.tsx             # 右键菜单：Add Text / Add Image / Add Video（shadcn/ui Button）
│   │   ├── store.ts                    # Zustand + subscribeWithSelector：完整 CRUD + 持久化
│   │   ├── types.ts                    # 统一节点数据模型：uiInfo + historys
│   │   └── nodes/
│   │       ├── index.ts                # nodeTypes 注册：{ text, image, video }
│   │       ├── NodeShell.tsx           # 共享包装器：NodeResizer + Handle（left/right）+ 标签
│   │       ├── TextNode.tsx            # 文本节点：双击编辑 + pushHistory
│   │       ├── ImageNode.tsx           # 图片节点：asset URL 解析 + <img>
│   │       └── VideoNode.tsx           # 视频节点：asset URL 解析 + <video controls muted>
│   ├── sidebar/
│   │   └── Sidebar.tsx                 # 项目名 + 关闭按钮 + 主题切换（shadcn/ui Button）
│   ├── project/
│   │   ├── types.ts                    # ProjectManifest + RecentProject
│   │   └── StartPage.tsx               # 创建项目 + 最近项目列表（shadcn/ui Button/Input）
│   ├── hooks/
│   │   └── useTheme.ts                 # 深色/浅色主题 hook
│   ├── lib/
│   │   ├── fs.ts                       # Tauri FS 封装：getDataDir / readJson / writeJson / importAsset / assetUrl
│   │   ├── id.ts                       # generateId()：crypto.randomUUID()
│   │   ├── project.ts                  # 项目 CRUD：create / load / save / list / delete
│   │   ├── auto-save.ts               # subscribeWithSelector + debounce 500ms 自动保存
│   │   ├── assets.ts                   # importImageFile / importVideoFile：文件复制 + 节点构建
│   │   └── utils.ts                    # cn() 样式合并工具
│   └── components/ui/                  # shadcn/ui 组件库
│       ├── button.tsx
│       ├── input.tsx
│       └── ...（30+ 组件）
├── src-tauri/
│   ├── Cargo.toml                      # + tauri-plugin-dialog, protocol-asset feature
│   ├── tauri.conf.json                 # CSP: asset: + http://asset.localhost, assetProtocol enabled
│   ├── capabilities/default.json       # 完整 FS scope（$APPDATA + $APPDATA/**）+ dialog:allow-open
│   └── src/
│       └── lib.rs                      # + tauri_plugin_dialog::init()
```

### 架构决策

**前端直接 FS（无 Rust IPC 命令）**：所有文件操作通过 `@tauri-apps/plugin-fs` + `@tauri-apps/api/path` 直接在 TypeScript 中完成。`convertFileSrc()` 提供 `asset://` URL 加载本地媒体。新增 `@tauri-apps/plugin-dialog` 处理文件选择对话框。

**统一节点数据模型**：所有节点类型共享 `CanvasNodeData { uiInfo, historys }` 结构，results 通过 `HistoryResult` 判别联合区分类型（text / image / video）。

### 存储布局

```
{appDataDir}/                            # ~/Library/Application Support/com.seedkit.canvas/
├── projects.json                        # RecentProject[] — 最近项目索引
└── projects/
    └── {uuid}/
        ├── manifest.json                # ProjectManifest { id, name, createdAt, updatedAt }
        ├── canvas.json                  # CanvasFile { viewport, nodes, edges }
        └── assets/                      # 导入的媒体文件
            ├── {uuid}.png
            └── {uuid}.mp4
```

### 节点数据模型

```typescript
type HistoryResult =
  | { type: "text"; content: string }
  | { type: "image"; url: string; width: number; height: number }
  | { type: "video"; url: string; width: number; height: number }

interface HistoryEntry {
  id: string
  parameters: Record<string, unknown>     // 自由格式参数
  result: HistoryResult                    // 判别联合结果
  createdAt: string
}

const MAX_HISTORYS = 20                    // LRU 上限

interface CanvasNodeData {
  uiInfo: { title: string }
  historys: HistoryEntry[]
}
```

### 实施备注

- **Tauri FS 权限 scope**：`$APPDATA/**` 仅匹配子路径，目录本身需要额外的 `$APPDATA` 条目。`ensureDir` 使用 `mkdir({ recursive: true })` + try/catch 代替 `exists()` + `mkdir()`，避免权限问题
- **ReactFlow Provider 模式**：Canvas.tsx 渲染 `<ReactFlowProvider>` 包裹 `<CanvasInner>`，因为 `useReactFlow()` 需要 Provider 祖先
- **Zustand subscribeWithSelector**：auto-save 使用 selector-based subscribe 监听 nodes/edges 变更
- **Viewport 保存**：通过 `onViewportChange` 跟踪 viewport 但不设置 `isDirty`（平移不触发保存），保存时包含当前 viewport
- **Asset URL**：`convertFileSrc(absolutePath)` → `asset://localhost/...`，CSP 必须允许 `asset:` 和 `http://asset.localhost` 在 `img-src` / `media-src`
- **拖拽导入**：使用 Tauri 的 `tauri://drag-drop` 事件（提供 OS 文件路径），而非 HTML5 drag events
- **NodeResizer**：节点可缩放，最小尺寸 250px，Handle 位置为 left/right
- **shadcn/ui**：ContextMenu、StartPage、Sidebar 使用 shadcn/ui 的 Button 和 Input 组件替代原生 HTML
- **Biome**：项目使用 Biome 进行代码规范和格式化

### 遇到的问题与修复

| 问题 | 原因 | 修复 |
|------|------|------|
| `forbidden path: $APPDATA` 运行时错误 | `$APPDATA/**` glob 不匹配目录本身 | capabilities 中添加 `{ "path": "$APPDATA" }` 条目 + `ensureDir` 改用 `mkdir({ recursive: true })` |
| `onPaneContextMenu` TypeScript 类型错误 | handler 签名 `React.MouseEvent` vs `MouseEvent \| React.MouseEvent` | 拓宽参数类型为 `MouseEvent \| React.MouseEvent` |
| `updateNodeData` 判别联合展开错误 | `Partial<CanvasNodeData>` 联合类型展开导致类型收窄 | 参数改为 `Record<string, unknown>` + `as CanvasNodeData` 断言 |

### 验证结果

- [x] `pnpm install` + `cargo check` — 依赖编译通过
- [x] `tsc --noEmit` — 类型检查通过
- [x] `pnpm tauri dev` — 应用启动
- [x] 启动页：创建项目 → 项目目录生成
- [x] 启动页：项目出现在最近列表，点击打开
- [x] 右键菜单 → "Add Text" → 文本节点出现
- [x] 双击文本节点 → 编辑内容 → 失焦保存
- [x] 右键 → "Add Image" → 文件对话框 → 图片显示在节点中
- [x] 右键 → "Add Video" → 文件对话框 → 视频在节点中播放
- [x] 拖拽图片文件到画布 → 创建图片节点
- [x] 任何变更后等待 500ms → `canvas.json` 已更新
- [x] 关闭 + 重新打开项目 → 状态恢复（节点、边、viewport）
- [x] 关闭项目 → 回到启动页

### Phase 2 增强：Save 指示器 + 卡片式 StartPage ✅

#### Save 状态指示器

**位置**：Sidebar header，project name 右侧

**三状态**：
| 状态 | 视觉 | 触发条件 |
|------|------|----------|
| Unsaved | amber 圆点 | `isDirty=true` |
| Saving | `<Loader2>` 旋转 + "Saving" | `isSaving=true`（auto-save 进行中） |
| Saved | `<Check>` + "Saved"（1.5s 后消失） | save 完成，isDirty=false |

**实现**：
- Store 新增 `isSaving: boolean` 状态 + `markSaving(saving)` action
- `auto-save.ts` 在保存前后调用 `markSaving(true/false)`
- `SaveIndicator` 组件使用 `hasSaved` flag 避免首次挂载时闪烁 "Saved"

#### 卡片式 StartPage

**布局**：`max-w-3xl`，responsive grid（2-3列）

**ProjectCard 设计**：
- 16:9 `aspect-video` 封面区域
- 有 cover：`<img>` 展示 `asset://` URL
- 无 cover：`<LayoutGrid>` icon 占位符（muted 风格）
- 底部：project name + relative timestamp
- 右上角：hover 显示删除按钮（backdrop-blur 背景）
- 整卡可点击打开项目

#### Cover 快照生成

**依赖**：`html-to-image`（toPng）

**流程**：
1. Auto-save 成功后，启动 3s debounce 的 cover capture timer
2. `captureCover()` 读取 `.react-flow__viewport` DOM 元素
3. `getNodesBounds()` + `getViewportForBounds()` 计算适合 640×360 的 viewport
4. `toPng()` 渲染 → base64 → `Uint8Array` → `writeFile()` 写入 `{projectDir}/cover.png`
5. `updateProjectCover()` 更新 `projects.json` 索引的 `coverPath` 字段

**新增文件**：
- `src/lib/cover.ts` — captureCover() 封面截图工具

**修改文件**：
- `src/canvas/store.ts` — 新增 `isSaving` / `markSaving`
- `src/lib/auto-save.ts` — isSaving 状态 + cover capture 调度
- `src/lib/project.ts` — `updateRecentProject` 支持 `coverPath`，新增 `updateProjectCover()`
- `src/project/types.ts` — `RecentProject.coverPath?: string`
- `src/project/StartPage.tsx` — 重写为 card grid 布局
- `src/sidebar/Sidebar.tsx` — 新增 `SaveIndicator` 组件

#### 验证结果

- [x] `tsc --noEmit` — 类型检查通过
- [x] `vite build` — 构建成功
- [ ] `pnpm tauri dev` — 待运行验证
- [ ] 编辑画布 → 侧边栏显示 amber dot → 500ms 后显示 "Saving" → 显示 "Saved" → 1.5s 后消失
- [ ] 创建项目 → 添加节点 → 等待 3.5s → `cover.png` 生成
- [ ] 关闭项目 → StartPage 显示 16:9 卡片 grid
- [ ] 卡片有封面图的显示封面，无封面的显示 placeholder icon
- [ ] hover 卡片右上角出现删除按钮

---

## Phase 3：AI Agent + MCP（概要） ⬅️ 当前目标

### 目标
- 侧边栏 Chat Panel（可折叠/拖拽调整宽度）
- 集成 `@seedkit-ai/ai-sdk-provider`，调用 Seed 2.0 模型
- Agent 通过 AI SDK tools 直接操作画布（前端内嵌方案）
- MCP tools：canvas_get_state / canvas_add_node / canvas_update_node / canvas_delete_node / canvas_add_edge / canvas_delete_edge / file_read / file_write

### 架构决策

**方案 A：前端内嵌（Phase 3 采用）**
- AI SDK 的 tool 定义直接调用 Zustand store 方法
- 无需独立 MCP 进程，简化架构
- canvas_* tools → Zustand store 直改
- file_* tools → Tauri IPC → Rust FS

**方案 B：独立 MCP Server（Phase 4 按需升级）**
- 标准 MCP 协议，外部 AI client（Claude Desktop 等）也能接入

### 关键文件
```
src/sidebar/
  ChatPanel.tsx             — Chat UI（替换占位 Sidebar）
  ChatMessage.tsx           — 消息气泡
  ChatInput.tsx             — 输入框

src/lib/
  agent.ts                  — AI agent 配置（system prompt, tools）
  mcp-tools.ts              — canvas CRUD + file access tool 定义
```

---

## Phase 4：进阶功能（概要）

- **版本管理**：canvas.json 快照 → `history/{timestamp}.json`，支持回滚
- **AI 图片生成**：调用 `seed.image()` 生成图片，写入 assets/ 并创建 Image 节点
- **AI 视频生成**：调用 `seed.video()` 生成视频，轮询完成后创建 Video 节点
- **导出**：画布导出为 PNG/PDF/JSON
- **标准 MCP Server**：升级为独立进程，支持外部 AI client 接入
- **协作预埋**：CRDT 数据结构（Yjs）预留接口
