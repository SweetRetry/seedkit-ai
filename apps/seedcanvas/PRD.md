# SeedCanvas — Product Requirements Document

## 1. 产品定义

**SeedCanvas** 是一款基于 Tauri v2 的桌面端无限画布应用，集成 AI Agent（Seed 2.0），支持文本、图片、视频节点的创作与编排。Agent 通过 MCP 协议直接操作画布数据和本地文件，实现"对话即创作"的体验。

### 核心价值
- **无限画布**：基于 ReactFlow 的节点式 UI，支持自由排列、连线、分组
- **多媒体节点**：文本（富文本/Markdown）、图片、视频三种核心节点类型
- **AI 原生**：侧边栏 Chat + MCP 协议，Agent 可读写画布、生成/编辑内容
- **本地优先**：所有数据存储在本地文件系统，无需云服务

---

## 2. 用户角色

| 角色 | 描述 |
|------|------|
| 创作者 | 使用画布组织灵感、素材、脚本，借助 AI 辅助内容创作 |

---

## 3. 核心功能

### 3.1 无限画布
- 无限缩放、平移的画布
- 拖拽创建/移动/删除节点
- 节点之间自由连线（edges）
- 多选、框选、批量操作
- 小地图 (Minimap)、画布控件 (Controls)

### 3.2 节点类型

| 类型 | 内容 | 交互 |
|------|------|------|
| **Text** | 纯文本 / Markdown | 双击编辑，支持富文本渲染 |
| **Image** | 本地图片 / AI 生成图 | 拖拽导入、预览、缩放 |
| **Video** | 本地视频 / AI 生成视频 | 拖拽导入、播放控件 |

### 3.3 AI Agent（侧边栏 Chat）
- 侧边栏 Chat Panel，支持流式输出
- Agent 调用 `@seedkit-ai/ai-sdk-provider` (Seed 2.0)
- 通过 MCP 协议操作画布：
  - 创建/修改/删除节点
  - 读取画布当前状态
  - 读写本地 assets 文件
- Agent 拥有的 MCP Tools：
  - `canvas_get_state` — 获取当前画布全部节点和连线
  - `canvas_add_node` — 添加节点（text/image/video）
  - `canvas_update_node` — 修改节点内容或位置
  - `canvas_delete_node` — 删除节点
  - `canvas_add_edge` / `canvas_delete_edge` — 连线管理
  - `file_read` / `file_write` — 读写项目目录下文件

### 3.4 项目管理
- 创建新画布项目
- 打开已有项目
- 最近项目列表
- 自动保存（debounce 策略）

---

## 4. 数据模型

### 4.1 项目文件结构
```
~/.seedcanvas/projects/{project-id}/
├── manifest.json        # 项目元数据
├── canvas.json          # 画布数据（nodes + edges + viewport）
├── assets/              # 媒体文件（图片、视频）
│   ├── {uuid}.png
│   ├── {uuid}.mp4
│   └── ...
└── history/             # 版本快照（未来）
    └── ...
```

### 4.2 manifest.json
```json
{
  "id": "uuid",
  "name": "My Canvas",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "version": 1,
  "schemaVersion": "1.0"
}
```

### 4.3 canvas.json
```json
{
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "nodes": [
    {
      "id": "node-uuid",
      "type": "text | image | video",
      "position": { "x": 100, "y": 200 },
      "data": {
        "content": "...",
        "assetPath": "assets/xx.png",
        "width": 300,
        "height": 200,
        "label": "optional label"
      }
    }
  ],
  "edges": [
    {
      "id": "edge-uuid",
      "source": "node-uuid-1",
      "target": "node-uuid-2",
      "type": "default"
    }
  ]
}
```

---

## 5. 技术栈

| 层 | 技术 |
|----|------|
| 桌面 Shell | Tauri v2 (Rust) |
| 前端框架 | React 19 + TypeScript |
| 构建 | Vite |
| 样式 | Tailwind CSS v4 |
| 画布 | @xyflow/react (ReactFlow v12) |
| 状态管理 | Zustand |
| AI SDK | ai@6.x + @seedkit-ai/ai-sdk-provider |
| MCP | 自建 MCP Server（Rust 侧，通过 Tauri IPC 桥接） |
| 文件 I/O | @tauri-apps/plugin-fs |
| 包管理 | pnpm workspace (monorepo) |

---

## 6. 非功能需求

- **性能**：1000+ 节点流畅交互（ReactFlow 虚拟化）
- **安全**：Tauri 最小权限原则，文件访问仅限项目目录 + 用户选择的路径
- **离线**：完全本地运行，无需网络（AI 调用除外）
- **跨平台**：macOS 优先，后续支持 Windows / Linux

---

## 7. Phase 路线图

| Phase | 目标 | 范围 |
|-------|------|------|
| **Phase 1** | 骨架 + 空画布 | Tauri shell + React + ReactFlow 空画布 + 基础文件结构 |
| **Phase 2** | 节点 CRUD | Text/Image/Video 节点创建编辑 + 文件持久化 + 自动保存 |
| **Phase 3** | AI Agent | 侧边栏 Chat + AI SDK 集成 + MCP 基础 tools |
| **Phase 4** | 进阶功能 | 版本管理、导出、AI 图片/视频生成、协作预埋 |
