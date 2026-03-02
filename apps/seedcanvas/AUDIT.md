# SeedCanvas 代码审计 (2026-03-02)

## Critical — ALL FIXED

### C1. ~~无孤儿目录检测/清理机制~~ ✅ FIXED
- 新增 `scan_orphan_projects` + `cleanup_orphan_projects` Tauri 命令
- Settings Storage 区增加"Scan orphan directories"按钮，显示扫描结果并可一键清理
- 同时清理磁盘目录和 SQLite 中关联的 tasks/assets 记录

### C2. ~~`keepAssets=true` 删除后资产不可追踪~~ ✅ FIXED
- `delete_project_data` 命令增加 `keep_assets` 参数
- 当 `keepAssets=true` 时仅删除 tasks 记录，保留 assets DB 记录（文件可继续在 Assets 页查看）

### C3. ~~`defaultImageModel` / `defaultVideoModel` 设置无效~~ ✅ FIXED
- Rust `Settings` 增加 `default_image_model` / `default_video_model` 字段
- `TaskQueue` 增加 `UserDefaults` 结构体，从 `settings.json` 读取
- `normalize()` 优先使用用户配置值，无配置时 fallback 到硬编码常量
- MCP binary (`seedcanvas-mcp.rs`) 同步更新

---

## Medium

### M1. ~~缺少 `assets` 表索引~~ ✅ FIXED
- 已添加 `idx_assets_created_at` 和 `idx_assets_task_id` 索引

### M2. 前端页面无错误提示
- **位置**: `AssetsPage.tsx:52`, `SettingsPage.tsx:34,52`, `UsagePage.tsx:10,13`
- **现象**: API 调用失败时 `.catch(() => {})` 静默吞错，用户看不到任何反馈
- **影响**: 数据加载失败时 UI 空白，用户无法判断是 bug 还是真的没数据

### M3. backfill 静默跳过损坏记录
- **位置**: `src-tauri/src/db.rs` backfill_assets_from_tasks()
- **现象**: JSON 解析失败或 assetPath 缺失时 `continue` 无日志
- **影响**: 丢失的资产记录无法被发现

### M4. 生成任务 asset 插入失败不影响任务状态
- **位置**: `src-tauri/src/tasks/image.rs`, `video.rs`
- **现象**: 任务标记为 done，但 asset 记录插入失败时仅 log error
- **影响**: 文件存在但 Assets 页看不到

---

## Low

### L1. ProjectsPage 不验证磁盘状态
- **位置**: `src/routes/ProjectsPage.tsx:137`
- **现象**: 直接渲染 `projects.json` 内容，不检查项目目录是否存在
- **影响**: 手动删除目录后 UI 仍显示，点击打开会报错

### L2. MCP bridge 超时无日志
- **位置**: `src-tauri/src/mcp_bridge.rs:233`
- **现象**: 30s 超时后静默失败
- **影响**: 调试困难

### L3. STORAGE_ANALYSIS.md 中仍提及已删除的 chat 表
- **位置**: `STORAGE_ANALYSIS.md:43-44,59`
- **现象**: 文档描述了 `chat_sessions` / `chat_messages` 表，但这些表已被 DROP
- **影响**: 文档误导
