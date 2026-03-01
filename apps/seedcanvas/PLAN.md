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
| React | 19.x |
| @xyflow/react | 12.x |
| Zustand | 5.x |
| Tailwind CSS | 4.x (`@tailwindcss/vite` plugin) |
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

## Phase 2：节点 CRUD + 持久化 ⬅️ 当前目标

### 目标
- 实现 Text / Image / Video 三种自定义节点组件
- 右键菜单 / 工具栏创建节点
- Text 节点双击编辑
- Image / Video 节点支持拖拽导入 + 文件对话框选择
- 文件持久化：Tauri IPC 命令读写 `canvas.json` + `manifest.json`
- 自动保存：debounce 500ms，状态变更后自动写入文件
- 项目管理 UI：创建 / 打开 / 最近项目列表

### 关键文件
```
src/canvas/nodes/
  TextNode.tsx              — 文本节点（Markdown 渲染 + 编辑态）
  ImageNode.tsx             — 图片节点（预览 + 缩放 handle）
  VideoNode.tsx             — 视频节点（播放器 + 控件）

src/lib/
  project.ts                — 项目 CRUD（create/open/list/save）
  auto-save.ts              — 自动保存逻辑

src-tauri/src/
  commands/
    project.rs              — IPC: create_project, open_project, list_projects
    canvas.rs               — IPC: save_canvas, load_canvas
    assets.rs               — IPC: import_asset, get_asset_path
```

### 实施步骤

1. 扩展 Zustand store：addNode / updateNode / deleteNode + loadCanvas / toCanvasFile
2. 实现 TextNode / ImageNode / VideoNode 自定义节点组件
3. 注册 nodeTypes，Canvas.tsx 绑定
4. Rust 侧 IPC commands：项目 CRUD + canvas 读写 + asset 导入
5. 前端 `lib/project.ts` + `lib/fs.ts` 桥接 Tauri IPC
6. 自动保存：Zustand subscribe + debounce → save_canvas IPC
7. 项目管理 UI：启动页 / 最近项目列表
8. 右键菜单 / 工具栏添加节点
9. 拖拽导入图片/视频文件
10. 验证：创建项目 → 添加节点 → 关闭重开 → 数据恢复

---

## Phase 3：AI Agent + MCP（概要）

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
