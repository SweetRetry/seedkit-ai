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

| 依赖 | 版本 | 用途 |
|------|------|------|
| Tauri | 2.10.2 | 桌面容器 |
| tauri-plugin-fs | 2.4.5 | 文件系统 |
| tauri-plugin-dialog | 2.x | 文件选择对话框 |
| React | 19.x | UI 框架 |
| @xyflow/react | 12.x | 画布 |
| Zustand | 5.x | 状态管理 |
| @tanstack/react-router | 1.x | 路由（hash history） |
| AI SDK (`ai`) | 6.x | LLM 调用 + tool loop |
| @seedkit-ai/ai-sdk-provider | workspace | Seed 2.0 / VolcEngine ARK |
| Tailwind CSS | 4.x | 样式（`@tailwindcss/vite`） |
| shadcn/ui (Radix) | latest | 组件库 |
| Biome | 2.3.x | linter + formatter |
| Vite | 6.4.1 | 构建 |
| TypeScript | 5.x | 类型系统 |

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
│   ├── main.tsx                        # React 19 入口：ThemeProvider + RouterProvider
│   ├── App.tsx                         # RootLayout：<Outlet /> 路由出口
│   ├── router.tsx                      # @tanstack/react-router：/ (StartPage) + /canvas/$projectId
│   ├── routes/
│   │   └── CanvasLayout.tsx            # URL param → store 同步 + auto-save 生命周期
│   ├── providers/
│   │   └── ThemeProvider.tsx           # 全局主题 context（dark/light/system）
│   ├── canvas/
│   │   ├── Canvas.tsx                  # ReactFlowProvider + CanvasInner（context menu / drag-drop / viewport）
│   │   ├── ContextMenu.tsx             # 右键菜单：Add Text / Add Image / Add Video（shadcn/ui Button）
│   │   ├── canvas.css                  # ReactFlow 自定义样式
│   │   ├── store.ts                    # Zustand + subscribeWithSelector：完整 CRUD + 持久化
│   │   ├── types.ts                    # 统一节点数据模型：uiInfo + historys
│   │   └── nodes/
│   │       ├── index.ts                # nodeTypes 注册：{ text, image, video }
│   │       ├── NodeShell.tsx           # 共享包装器：NodeResizer + Handle（left/right）+ 标签
│   │       ├── TextNode.tsx            # 文本节点：双击编辑 + pushHistory
│   │       ├── ImageNode.tsx           # 图片节点：asset URL 解析 + <img>
│   │       └── VideoNode.tsx           # 视频节点：asset URL 解析 + <video controls muted>
│   ├── project/
│   │   ├── types.ts                    # ProjectManifest + RecentProject
│   │   └── StartPage.tsx               # 卡片式项目列表 + 创建项目（shadcn/ui）
│   ├── hooks/
│   │   └── useTheme.ts                 # 深色/浅色主题 hook
│   ├── lib/
│   │   ├── fs.ts                       # Tauri FS 封装：getDataDir / readJson / writeJson / importAsset / assetUrl
│   │   ├── id.ts                       # generateId()：crypto.randomUUID()
│   │   ├── project.ts                  # 项目 CRUD：create / load / save / list / delete
│   │   ├── auto-save.ts               # subscribeWithSelector + debounce 500ms 自动保存
│   │   ├── cover.ts                    # captureCover() 封面截图
│   │   ├── assets.ts                   # importImageFile / importVideoFile：文件复制 + 节点构建
│   │   ├── settings.ts                 # AppSettings 持久化（apiKey, baseURL, model）
│   │   └── utils.ts                    # cn() 样式合并工具
│   └── components/ui/                  # shadcn/ui 组件库（30+ 组件）
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

### Phase 2 增强：路由 + 主题 + Save 指示器 + 卡片式 StartPage ✅

#### 路由重构

**从**：App.tsx 内部 `projectId` 条件渲染
**到**：`@tanstack/react-router` + hash history

| 路径 | 组件 | 用途 |
|------|------|------|
| `/` | `StartPage` | 项目列表 + 创建 |
| `/canvas/$projectId` | `CanvasLayout` | 画布 + 侧边栏 |

- `CanvasLayout` 管理 URL param → store 同步、auto-save 生命周期、closeProject cleanup
- `RootLayout`（App.tsx）只负责 `<Outlet />`

#### 主题系统

- `ThemeProvider` 全局 context（dark / light / system），持久化到 localStorage
- 主题切换按钮集成到 Sidebar header

#### Save 状态指示器

**位置**：Sidebar header，project name 右侧

**三状态**：
| 状态 | 视觉 | 触发条件 |
|------|------|----------|
| Unsaved | amber 圆点 | `isDirty=true` |
| Saving | `<Loader2>` 旋转 + "Saving" | `isSaving=true`（auto-save 进行中） |
| Saved | `<Check>` + "Saved"（1.5s 后消失） | save 完成，isDirty=false |

#### 卡片式 StartPage

- `max-w-3xl` responsive grid（2-3列）
- 16:9 `aspect-video` 封面区域（`html-to-image` 生成 cover.png）
- hover 显示删除按钮

#### Cover 快照生成

`src/lib/cover.ts` — auto-save 后 3s debounce → `toPng()` → `{projectDir}/cover.png`

---

## Phase 3：AI Agent ✅ 已完成

### 交付物

```
apps/seedcanvas/src/canvas/chat/
├── store.ts                            # Zustand chat state：messages, streaming, tool calls, sendMessage/stop/clear
├── system-prompt.ts                    # 动态 system prompt：canvas snapshot + viewport + selected nodes
├── tools/                              # AI SDK tools（模块化拆分）
│   ├── index.ts                        # createCanvasTools() 统一入口
│   ├── helpers.ts                      # getStore() + history 序列化 + 格式化工具
│   ├── canvas-query.ts                 # canvas_query：组合 scope 查询（all/nodes/edges/selected）
│   ├── canvas-batch.ts                 # canvas_batch：原子批量操作（add_node/update_node/delete/add_edge）
│   ├── read-content.ts                 # read_content：统一内容读取（文本/图片缩略图/视频描述）
│   └── web.ts                          # web_search + web_fetch
└── components/
    ├── Sidebar.tsx                     # 项目 header + SaveIndicator + 主题切换 + 设置 + ChatPanel
    ├── ChatPanel.tsx                   # 消息列表 + streaming 显示 + 输入框
    ├── SettingsDialog.tsx              # API Key / Base URL / Model 配置（持久化到 settings.json）
    └── SelectedNodeIndicator.tsx       # 选中节点提示标签

apps/seedcanvas/src/lib/
└── settings.ts                         # AppSettings { apiKey, baseURL, model } + load/save
```

### 架构决策

**前端内嵌方案**（无独立 MCP 进程）：
- AI SDK `streamText()` + `tool()` 定义直接在浏览器端运行
- canvas_* tools → Zustand `useCanvasStore.getState()` 直改画布
- file_* tools → `@tauri-apps/plugin-fs` 读本地文件
- 模型调用：`@seedkit-ai/ai-sdk-provider` 的 `createSeed()` → VolcEngine ARK API

### Tool 清单（6 个，Phase 3 完成时已合并为 Phase 4 目标结构）

| Tool | 用途 |
|------|------|
| `canvas_query` | 组合 scope 查询：all（全量摘要）/ nodes（按 ID 详情）/ edges / selected，scope 为数组可组合 |
| `canvas_batch` | 原子批量操作：add_node / update_node / delete / add_edge，支持 ref 引用 |
| `read_content` | 统一内容读取：自动检测文本/图片/视频，支持 node ID / 文件路径 / URL |
| `web_search` | Exa Web 搜索 |
| `web_fetch` | 抓取网页文本内容 |
| ~~`generate_text`~~ | **已移除** — 模型直接生成文本 + canvas_batch 写入，无需独立 tool |

### System Prompt 设计

- **动态注入**：每次 `sendMessage` 时从 Zustand store 构建 canvas context
- **Canvas snapshot**：所有节点的 id、类型、位置、标题、最新内容摘要（前 200 字）
- **Edge 关系**：以 `"Title A" → "Title B"` 可读格式展示
- **Selected 节点**：高亮当前选中，支持 "this node" / "selected" 指代
- **Tool strategy**：指导 agent 先观察再操作，新节点必须连边记录来源

### Chat Store 架构

- `ChatMessage { id, role, content, reasoning?, toolCalls[] }`
- `ToolCallEntry { id, toolName, input, output?, status }`
- Streaming：`streamingText` + `streamingReasoning` 实时更新
- `AbortController` 支持中断生成
- `stepCountIs(10)` 最多 10 轮 tool loop

### 新增依赖

| 依赖 | 用途 |
|------|------|
| `ai@^6.0.104` | Vercel AI SDK v6（streamText, tool） |
| `@seedkit-ai/ai-sdk-provider` | Seed 2.0 / VolcEngine ARK provider |
| `zod@^4.3.5` | Tool input schema 定义 |
| `@tanstack/react-router` | 文件路由 |
| `@fontsource/geist-sans` / `geist-mono` | 字体 |
| `motion@^12.34.3` | Framer Motion 动画 |
| `shiki@^4.0.0` | 代码高亮 |
| `streamdown` / `@streamdown/*` | Markdown 渲染 |
| `lucide-react` | 图标库 |

### 实施备注

- **AI SDK 在浏览器端运行**：`createSeed()` 直接在前端发起 HTTP 请求到 VolcEngine ARK，无 Node.js 后端
- **Settings 持久化**：`{appDataDir}/settings.json`，API Key 等配置不随项目走
- **Sidebar 重组**：原 `src/sidebar/` 迁移到 `src/canvas/chat/components/`，Sidebar 现在包含 header + ChatPanel
- **ai-elements 组件库**：`src/components/ai-elements/` 包含 40+ 预制 AI UI 组件（prompt-input、message、code-block、reasoning 等），为未来丰富 Chat UI 预留

---

## Phase 4：Rust MCP Server + 长任务引擎 ⬅️ 当前目标

### 目标

让 SeedCanvas 同时服务两类调用者：
1. **内置 Chat**（前端 AI SDK）— 短任务继续走前端，长任务下发到 Rust
2. **外部 AI Client**（Claude Desktop / Cursor）— 通过 MCP stdio 协议调用画布 + 生成能力

### 整体架构

```
┌─ Claude Desktop / Cursor ─────────────────────┐
│  MCP Client                                    │
└──────────┬─────────────────────────────────────┘
           │ stdio (JSON-RPC)
           ▼
┌─ seedcanvas-mcp (Rust 二进制) ─────────────────┐
│                                                 │
│  rmcp SDK (stdio transport)                     │
│  ├── #[derive(ServerHandler)] 自动协议处理       │
│  └── #[tool] 宏声明 → 自动 tools/list           │
│                                                 │
│  Tool Handlers（5 tools）                        │
│  ├── canvas_read ────────── IPC ──→ WebView     │
│  ├── canvas_batch ───────── IPC ──→ WebView     │
│  ├── generate_image ─────→ ARK API (sync ~30s)  │
│  ├── generate_video ─────→ Task Queue           │
│  └── task_status ────────→ SQLite query         │
│                                                 │
│  Task Queue (长任务引擎)                         │
│  ├── submit → task_id                           │
│  ├── poll ARK API (async loop)                  │
│  ├── 完成 → 写 assets/ + IPC 通知 WebView       │
│  └── task_status 查询                            │
│                                                 │
└──────────┬─────────────────────────────────────┘
           │ Tauri IPC (双向)
           ▼
┌─ WebView (前端) ───────────────────────────────┐
│                                                 │
│  内置 Chat (AI SDK streamText — 5 tools)         │
│  ├── canvas_read / canvas_batch → Zustand store  │
│  ├── generate_image/video → invoke() → Rust     │
│  └── listen("task:complete") → 更新 store       │
│                                                 │
│  画布渲染 + 用户交互                              │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 关键设计决策

#### 0. 存储架构：文档模型 + SQLite 辅助

**核心原则：canvas.json 文档模型不动，SQLite 只管辅助数据。**

AI 原生应用（如 Pencil.dev）的存储设计启示：
- 设计稿 / 画布本质是 **节点树**，不是关系表 — 拆进 SQLite 反而需要 JSON 列或大量 join
- AI 需要的是结构化的文档快照（`canvas_get_state` 直接返回节点树），不是 SQL 查询
- 文档模型对人和 AI 都是一等公民：人看画布渲染，AI 读 JSON 结构

**存储分工**：

```
{appDataDir}/
├── projects.json                # 项目索引 — 小文件，低频读写
├── settings.json                # 全局配置 — API Key, Model
├── seedcanvas.db                # SQLite — 辅助数据
│   ├── tasks                    #   长任务状态机（pending → running → done/failed）
│   └── snapshots                #   Phase 5: canvas.json 版本快照索引
└── projects/
    └── {uuid}/
        ├── canvas.json          # 主数据 — 节点树 + 边 + viewport（文档模型）
        ├── assets/              # 二进制媒体文件
        └── cover.png            # 封面截图
```

**为什么不把 canvas.json 迁入 SQLite**：
- 节点有自由 schema（text/image/video 字段不同），塞关系表要么 JSON 列要么多态表
- 所有写入已归到 WebView Zustand store 单点，无并发竞态
- `canvas_get_state` 返回整棵树，和文件 1:1 映射，无需 SQL 查询
- 人可以直接 cat/编辑 canvas.json 调试

**SQLite 只做它擅长的事**：
- 长任务状态机：按状态查询（`WHERE status = 'running'`）、重启恢复
- 版本快照索引：时间戳查询、按项目筛选、清理过期快照
- 未来扩展：全文搜索、操作审计日志

**SQLite schema**：

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  type        TEXT NOT NULL,           -- 'image' | 'video'
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending → running → done | failed
  input       TEXT NOT NULL,           -- JSON: { prompt, nodeId?, ... }
  output      TEXT,                    -- JSON: { assetPath, width, height, ... }
  ark_task_id TEXT,                    -- ARK API 返回的远程 task ID
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Phase 5 预留
CREATE TABLE snapshots (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  canvas_json TEXT NOT NULL,           -- 完整 canvas.json 快照
  label       TEXT,                    -- 可选标签（"before AI batch", "manual save"）
  created_at  TEXT NOT NULL
);
```

**重启恢复流程**：
1. Tauri 启动时查询 `SELECT * FROM tasks WHERE status = 'running'`
2. 对每个 running 任务，恢复 ARK API 轮询（用 `ark_task_id`）
3. pending 任务重新提交

#### 1. MCP Server：`rmcp` crate + 独立二进制

**选择：独立二进制 `seedcanvas-mcp`**

MCP stdio 要求进程的 stdin/stdout 用于 JSON-RPC，但 Tauri 主进程的 stdout 被框架占用，因此 MCP 必须是独立二进制。

**使用 `rmcp` crate**（Rust MCP SDK）省去手写 JSON-RPC：
- `#[derive(ServerHandler)]` 宏自动生成 MCP 协议处理
- `#[tool]` 属性宏声明 tool，自动生成 `tools/list` + input schema
- 内置 stdio transport，只需 `serve_server(StdioTransport, handler).await`
- 省掉 ~400 行手写协议代码

```rust
use rmcp::{ServerHandler, tool};

#[derive(ServerHandler)]
struct SeedCanvasMcp {
    ark_client: ArkClient,
    task_queue: TaskQueue,
    canvas_tx: mpsc::Sender<CanvasRequest>,
}

#[tool(description = "Read canvas state — query nodes/edges by id, pattern, or selection")]
async fn canvas_read(&self, mode: String, ids: Option<Vec<String>>) -> String {
    let (tx, rx) = oneshot::channel();
    self.canvas_tx.send(CanvasRequest::Read { mode, ids, reply: tx }).await?;
    rx.await?
}

#[tool(description = "Batch canvas operations — atomically add/update/delete nodes and edges")]
async fn canvas_batch(&self, operations: Vec<Operation>) -> String {
    let (tx, rx) = oneshot::channel();
    self.canvas_tx.send(CanvasRequest::Batch { operations, reply: tx }).await?;
    rx.await?
}

#[tool(description = "Generate an image using ARK API")]
async fn generate_image(&self, prompt: String, node_id: Option<String>) -> String {
    let task_id = self.task_queue.submit_image(prompt, node_id).await;
    format!("Task submitted: {task_id}")
}
```

#### 2. 画布操作的 IPC 路径

外部 MCP 调用画布操作时，数据流：

```
MCP Client → seedcanvas-mcp (Rust)
    → Tauri Event: "mcp:canvas_batch" { operations }
    → WebView 监听 → useCanvasStore.getState().batchApply(ops)
    → 操作结果通过 Event 回传 → MCP response
```

前端需要注册 Event listener，桥接 MCP 请求到 Zustand store，然后回传结果。

#### 3. 长任务：前端 AI SDK tool 如何下发

内置 chat 的 `generate_image` / `generate_video` tool 改为：

```typescript
// tools.ts — 长任务 tool 不再在前端执行，而是 invoke Rust
generate_image: tool({
  inputSchema: z.object({ prompt: z.string(), nodeId: z.string().optional() }),
  execute: async ({ input }) => {
    const taskId = await invoke("generate_image", { prompt: input.prompt })
    // 不阻塞 tool loop — 立即返回 taskId
    return { taskId, status: "submitted", message: "图片生成中，完成后会自动添加到画布" }
  }
})
```

Rust 端完成后通过 Event 通知前端更新画布。

#### 4. VolcEngine ARK API 对接

| 能力 | ARK API | Rust 实现 |
|------|---------|-----------|
| 图片生成 | `POST /images/generations` | `reqwest` 同步请求 (~30s) |
| 视频生成 | `POST /videos/generations` → task_id | 提交后轮询 `GET /videos/generations/{id}` |
| 文本生成 | `POST /chat/completions` | 前端 AI SDK 已覆盖，Rust 端不需要 |

Rust 端只需要对接图片和视频生成 API，文本生成继续走前端 AI SDK。

### MCP Tool 清单（5 个，复用前端 canvas_query / canvas_batch）

**设计原则**：借鉴 Pencil.dev — 用 `batch_get` + `batch_design` 两个核心 tool 覆盖所有画布操作，而非每个 CRUD 操作一个 tool。减少 tool 数量让 AI 选择更快、system prompt 更短、每次 tool call 做更多事。

| Tool | 类型 | 说明 |
|------|------|------|
| `canvas_query` | 读取 | 组合 scope 查询：all / nodes / edges / selected，scope 为数组可组合 |
| `canvas_batch` | 写入 | 原子批量操作：add_node/update_node/delete/add_edge，ref 引用新建节点 |
| `generate_image` | 长任务 | ARK 图片生成 → 写入 assets → 创建/更新节点 |
| `generate_video` | 长任务 | ARK 视频生成 → 轮询 → 写入 assets → 创建/更新节点 |
| `task_status` | 读取 | 查询长任务进度 |

#### `canvas_query`：组合查询（已实现，合并 get_state + get_node + get_selected）

scope 为数组，可在一次调用中组合多种查询：

```json
// 获取全量摘要
{ "scope": ["all"] }

// 按 ID 获取节点详情（含完整 history）
{ "scope": ["nodes"], "nodeIds": ["node-1", "node-2"] }

// 获取当前选中节点
{ "scope": ["selected"] }

// 组合查询：同时拿特定节点和特定边
{ "scope": ["nodes", "edges"], "nodeIds": ["node-1"], "edgeIds": ["e-1"] }
```

scope="all" 返回节点摘要（id/type/title/position/latestResult），scope="nodes" 返回完整 history。媒体节点只显示尺寸，需要 `read_content` 查看视觉内容。

#### `canvas_batch`：原子批量操作（已实现，借鉴 Pencil.dev `batch_design`）

AI agent 一个 turn 通常需要多步画布操作（创建节点 → 连边 → 更新内容）。逐个 tool call 的问题：中间任何一步失败，画布处于半完成状态，无法回滚。

`canvas_batch` 将多个操作打包为一次原子调用：

```json
{
  "operations": [
    { "op": "add_node", "ref": "summary", "type": "text", "title": "Summary", "initialContent": "...", "position": { "x": 400, "y": 200 } },
    { "op": "add_node", "ref": "analysis", "type": "text", "title": "Analysis", "position": { "x": 600, "y": 200 } },
    { "op": "add_edge", "source": "existingNodeId", "target": "summary" },
    { "op": "update_node", "nodeId": "existingNodeId", "newContent": "..." }
  ]
}
```

- `ref` 字段为新建节点命名，后续 `add_edge` 可用 ref 名引用（比 `$0` 索引更可读）
- 操作顺序执行，每步从最新 store 读取
- 支持的 op：`add_node` / `update_node` / `delete`（统一删除 node+edge） / `add_edge`
- `delete` op 同时接受 `nodeIds` 和 `edgeIds`，合并了原来的 `delete_node` + `delete_edge`

### 文件结构

```
src-tauri/
├── Cargo.toml                      # + rmcp, reqwest, rusqlite, serde_json, tokio
├── src/
│   ├── lib.rs                      # Tauri plugin 注册 + IPC commands
│   ├── mcp.rs                      # #[derive(ServerHandler)] + #[tool] 宏（~200 行）
│   ├── db.rs                       # SQLite 初始化 + migration + CRUD（~150 行）
│   ├── tasks/
│   │   ├── mod.rs                  # TaskQueue：submit / poll / status / 重启恢复
│   │   ├── image.rs                # ARK 图片生成
│   │   └── video.rs                # ARK 视频生成 + 轮询
│   └── ark/
│       ├── mod.rs                  # ARK HTTP client（reqwest）
│       └── types.rs                # ARK API request/response 类型
├── bin/
│   └── seedcanvas-mcp.rs           # MCP 独立二进制入口（~30 行）

src/canvas/
├── store.ts                        # + batchApply() 原子批量操作（Phase 4 待加）
├── chat/
│   ├── tools/                      # ✅ 已完成模块化拆分（canvas-query + canvas-batch + read-content + web）
│   └── bridge.ts                   # NEW: MCP Event listener 桥接层
```

### 前端桥接层 (`bridge.ts`)

只需两个 Event listener — 对应两个画布 tool：

```typescript
import { emit, listen } from "@tauri-apps/api/event"
import { useCanvasStore } from "@/canvas/store"

export function setupMcpBridge() {
  // canvas_query — 查询画布状态
  listen("mcp:canvas_query", (event) => {
    const { requestId, scope, nodeIds, edgeIds } = event.payload
    const store = useCanvasStore.getState()
    // 复用 canvas_query 的 scope 逻辑（和前端 tools/canvas-query.ts 相同）
    const result = executeCanvasQuery({ scope, nodeIds, edgeIds }, store)
    emit("mcp:response", { id: requestId, result })
  })

  // canvas_batch — 原子批量操作
  listen("mcp:canvas_batch", (event) => {
    const { requestId, operations } = event.payload
    const store = useCanvasStore.getState()
    const result = store.batchApply(operations) // 成功返回结果，失败返回 error
    emit("mcp:response", { id: requestId, result })
  })
}
```

### Claude Desktop 配置

```json
{
  "mcpServers": {
    "seedcanvas": {
      "command": "/Applications/SeedCanvas.app/Contents/MacOS/seedcanvas-mcp",
      "args": []
    }
  }
}
```

### 实施步骤

1. **SQLite 基础**：`db.rs`，初始化 + migration + tasks 表 CRUD（~150 行）
2. **Rust ARK Client**：`ark/` 模块，reqwest 封装 image/video generation API（~200 行）
3. **Task Queue**：`tasks/` 模块，tokio spawn 异步轮询，SQLite 持久化，重启恢复（~400 行）
4. **IPC Commands**：`lib.rs` 注册 `generate_image` / `generate_video` / `task_status` 命令（~150 行）
5. **MCP Server**：`mcp.rs`，`rmcp` 宏声明 5 个 tools（~150 行，tool 数量减少）
6. **MCP Binary**：`bin/seedcanvas-mcp.rs` 入口（~30 行）
7. **前端 store 改造**：`store.ts` 新增 `batchApply()`（clone → execute → commit/rollback）（~150 行）
8. ~~**前端 tools 合并**~~ **✅ 已完成**：`tools/` 模块化拆分（canvas-query + canvas-batch + read-content + web），6 个 tool（generate_text 已移除）
9. **前端桥接**：`bridge.ts` 仅 2 个 Event listener（~80 行）
10. **Sidecar 打包**：`tauri.conf.json` 配置 sidecar binary

**总计 ~1500 行**（Rust ~1080 + TypeScript ~430）

### 前端 tools 迁移对照 ✅ 已完成

| Phase 3 原 tool | 实际归属 | 变化 |
|-----------------|---------|------|
| `canvas_get_state` | `canvas_query` scope=["all"] | 合并，scope 为数组可组合 |
| `canvas_get_node` | `canvas_query` scope=["nodes"] + nodeIds | 合并 |
| `canvas_get_selected` | `canvas_query` scope=["selected"] | 合并 |
| `canvas_add_node` | `canvas_batch` op="add_node" | 合并，支持 ref 引用 |
| `canvas_update_node` | `canvas_batch` op="update_node" | 合并 |
| `canvas_delete_node` | `canvas_batch` op="delete" | 合并（node+edge 统一删除） |
| `canvas_add_edge` | `canvas_batch` op="add_edge" | 合并，支持 ref 解析 |
| `canvas_delete_edge` | `canvas_batch` op="delete" | 合并（node+edge 统一删除） |
| `read_file` | `read_content`（统一） | 合并，自动检测文本/媒体 |
| `read_media` | `read_content`（统一） | 合并，图片缩略图 + 视频 vision 描述 |
| `web_search` | `web_search` | 保留，Exa MCP 实现 |
| `web_fetch` | `web_fetch` | 保留，DOMParser 提取正文 |
| `generate_text` | **已移除** | 模型直接生成 + canvas_batch 写入 |

### 待确认

- [ ] ARK 图片/视频生成 API 的具体 endpoint 和鉴权方式
- [ ] MCP binary 是否需要独立的 API Key 配置，还是复用前端 settings.json
- [ ] 视频生成轮询间隔（建议 5s）和超时时间（建议 10min）

---

## Phase 5：进阶功能（概要）

- **版本管理**：canvas.json 快照 → SQLite `snapshots` 表（schema 已预留），支持按时间回滚
- **导出**：画布导出为 PNG/PDF/JSON
- **Chat UI 增强**：使用 ai-elements 组件库丰富消息渲染（代码高亮、Markdown、reasoning 展示等）
- **SSE Transport**：MCP Server 增加 HTTP SSE 传输，支持远程 client
- **协作预埋**：CRDT 数据结构（Yjs）预留接口
