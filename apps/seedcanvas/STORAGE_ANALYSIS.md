# SeedCanvas 存储架构分析

## 目录结构

```
{appDataDir}/                          # macOS: ~/Library/Application Support/com.seedkit.canvas/
│
├── seedcanvas.db                      # ← SQLite (tasks, assets)
├── settings.json                      # ← File-based
├── projects.json                      # ← File-based (最近项目索引)
│
└── projects/
    └── {projectId}/
        ├── manifest.json              # ← File-based (项目元数据)
        ├── canvas.json                # ← File-based (画布状态) ⚠️ 可能很大
        ├── cover.png                  # ← File-based (缩略图截图)
        └── assets/
            ├── {uuid}.png            # ← File-based (生成/导入的图片) ⚠️ 磁盘大户
            └── {uuid}.mp4            # ← File-based (生成/导入的视频) ⚠️ 磁盘大户
```

---

## File-Based 存储

| 文件 | 内容 | 大小特征 | 增长模式 |
|------|------|----------|----------|
| `settings.json` | API key, base URL, 默认模型 | ~200 B | 几乎不变 |
| `projects.json` | 最近项目列表 (max 50) | ~5-10 KB | 缓慢 |
| `manifest.json` | 项目名、版本、时间戳 | ~200 B / project | 缓慢 |
| `canvas.json` | 节点、边、视口状态 | **5 KB - 500 KB** | 随编辑增长 |
| `cover.png` | 画布截图缩略图 (640x360) | ~50-200 KB / project | 每次保存更新 |
| `assets/*.png` | 生成/导入的图片 | **100 KB - 5 MB / 张** | **快速增长** |
| `assets/*.mp4` | 生成/导入的视频 | **10 MB - 100+ MB / 个** | **快速增长** |
| `~/.claude.json` | MCP 配置 (外部文件) | ~500 B | 不变 |

## SQLite 存储 (`seedcanvas.db`)

| 表 | 内容 | 行大小 | 增长模式 |
|----|------|--------|----------|
| `tasks` | 生成任务历史 (input JSON, output JSON, 状态) | ~500 B / row | 每次生成 +1 |
| `assets` | 资产元数据目录 (路径、prompt、模型、尺寸) | ~300-500 B / row | 每次生成/导入 +1 |

## localStorage (浏览器)

| Key | 内容 | 大小 |
|-----|------|------|
| `seedcanvas-theme` | `"system"` / `"light"` / `"dark"` | ~10 B |

---

## 磁盘空间消耗排序（从大到小）

1. **`assets/*.mp4`** — 视频文件，单个 10-100+ MB，绝对大户
2. **`assets/*.png`** — 图片文件，单个 100KB-5MB，量大后也很可观
3. **`canvas.json`** — 节点多时可到几百 KB，每次保存全量覆写
4. **`seedcanvas.db`** — 整个 DB 文件通常 < 1 MB

---

## 冗余关系

- `assets` 表 ↔ `tasks` 表的 `output` 字段：`assets` 表是 `tasks.output` JSON 里 `assetPath` 的结构化镜像，方便查询
- `projects.json` ↔ 实际 `projects/` 目录：索引文件是目录内容的派生缓存
- `assets` 表的 `file_path` ↔ 磁盘上的实际文件：元数据 vs 二进制，两者必须同步

---

## 已知问题

1. ~~**删除项目时 tasks 表不清理**~~ — 已修复：`delete_project_data` 同时清理 tasks + assets
2. **canvas.json 全量写入** — 如果画布节点很多，每次 auto-save (500ms debounce) 都写几百 KB
3. **无自动清理/过期机制** — 资产只增不减，除非手动删除项目
4. **无磁盘配额/警告** — 用户无法感知磁盘占用直到空间不足
