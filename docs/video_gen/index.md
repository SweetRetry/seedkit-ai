# Seedance 视频生成 API 参考

## 模型

| | Seedance 1.5 pro | Seedance 1.0 pro | Seedance 1.0 pro fast | Seedance 1.0 lite t2v | Seedance 1.0 lite i2v |
|---|---|---|---|---|---|
| **Model ID** | doubao-seedance-1-5-pro-251215 | doubao-seedance-1-0-pro-250528 | doubao-seedance-1-0-pro-fast-251015 | doubao-seedance-1-0-lite-t2v-250428 | doubao-seedance-1-0-lite-i2v-250428 |
| 文生视频 | ✓ | ✓ | ✓ | ✓ | ✗ |
| 图生视频（首帧） | ✓ | ✓ | ✓ | ✗ | ✓ |
| 图生视频（首尾帧） | ✓ | ✓ | ✗ | ✗ | ✓ |
| 图生视频（参考图） | ✗ | ✗ | ✗ | ✗ | ✓ (1-4张) |
| 有声视频 | ✓ | ✗ | ✗ | ✗ | ✗ |
| 返回视频尾帧 | ✓ | ✓ | ✓ | ✓ | ✓ |
| **输出分辨率** | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p | 480p, 720p, 1080p |
| **默认分辨率** | 720p | 1080p | 1080p | 720p | 720p |
| **输出宽高比** | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16, adaptive | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 | 21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |
| **输出时长** | 4–12 秒 | 2–12 秒 | 2–12 秒 | 2–12 秒 | 2–12 秒 |
| **输出格式** | mp4 | mp4 | mp4 | mp4 | mp4 |

---

## 工作流程

视频生成为异步接口，分两步完成：

1. 调用 `POST /contents/generations/tasks` 创建任务，获得任务 ID
2. 轮询 `GET /contents/generations/tasks/{id}`，直到 `status` 变为 `succeeded`，从 `content.video_url` 下载 mp4 文件

---

## 创建任务

`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`

### 请求参数

#### model `string` (必需)

调用的模型 ID，见上方模型表。

#### content `object[]` (必需)

输入内容，支持文本、图片两种类型，可组合使用。

**文本**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `content[].type` | string | ✓ | 固定为 `"text"` |
| `content[].text` | string | ✓ | 提示词。中文建议不超过 500 字，英文建议不超过 1000 词 |

**图片**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `content[].type` | string | ✓ | 固定为 `"image_url"` |
| `content[].image_url.url` | string | ✓ | 图片 URL 或 Base64（格式：`data:image/<格式>;base64,<内容>`） |
| `content[].role` | string | 条件必填 | 见下方说明 |

图片要求：jpeg / png / webp / bmp / tiff / gif（Seedance 1.5 pro 另支持 heic / heif）；宽高比 (0.4, 2.5)；边长 300–6000 px；大小 < 30 MB。

`content[].role` 取值规则：

| 场景 | 图片数量 | role |
|------|---------|------|
| 图生视频（首帧） | 1 张 | `first_frame` 或不填 |
| 图生视频（首尾帧） | 2 张 | 首帧 `first_frame`，尾帧 `last_frame` |
| 图生视频（参考图，仅 lite i2v） | 1–4 张 | 全部填 `reference_image` |

#### return_last_frame `boolean` (可选，默认 `false`)

是否在响应中返回生成视频的尾帧图像（png 格式）。

#### generate_audio `boolean` (可选，默认 `true`，仅 Seedance 1.5 pro)

| 值 | 说明 |
|----|------|
| `true` | 包含同步音频（人声、音效、背景音乐） |
| `false` | 无声视频 |

#### resolution `string` (可选)

**默认值：** Seedance 1.5 pro / 1.0 lite 为 `720p`，Seedance 1.0 pro / pro-fast 为 `1080p`

可选值：`480p` | `720p` | `1080p`（参考图场景不支持）

#### ratio `string` (可选)

**默认值：** Seedance 1.5 pro 文生视频为 `adaptive`，其余为 `16:9`；图生视频均为 `adaptive`

可选值：`16:9` | `4:3` | `1:1` | `3:4` | `9:16` | `21:9` | `adaptive`

`adaptive` 规则：图生视频（首帧/首尾帧）根据首帧图片比例自动适配；文生视频仅 Seedance 1.5 pro 支持；参考图场景不支持。

**各分辨率对应像素值：**

| 分辨率 | 宽高比 | Seedance 1.0 系列 | Seedance 1.5 pro |
|--------|--------|-------------------|-----------------|
| 480p | 16:9 | 864×480 | 864×496 |
| | 4:3 | 736×544 | 752×560 |
| | 1:1 | 640×640 | 640×640 |
| | 3:4 | 544×736 | 560×752 |
| | 9:16 | 480×864 | 496×864 |
| | 21:9 | 960×416 | 992×432 |
| 720p | 16:9 | 1248×704 | 1280×720 |
| | 4:3 | 1120×832 | 1112×834 |
| | 1:1 | 960×960 | 960×960 |
| | 3:4 | 832×1120 | 834×1112 |
| | 9:16 | 704×1248 | 720×1280 |
| | 21:9 | 1504×640 | 1470×630 |
| 1080p | 16:9 | 1920×1088 | 1920×1080 |
| | 4:3 | 1664×1248 | 1664×1248 |
| | 1:1 | 1440×1440 | 1440×1440 |
| | 3:4 | 1248×1664 | 1248×1664 |
| | 9:16 | 1088×1920 | 1080×1920 |
| | 21:9 | 2176×928 | 2206×946 |

#### duration `integer` (可选，默认 `5`)

生成视频时长（秒）。

- Seedance 1.0 系列：[2, 12]
- Seedance 1.5 pro：[4, 12]，或设为 `-1` 由模型自动选择

#### frames `integer` (可选，Seedance 1.5 pro 不支持)

生成视频帧数，用于控制小数秒精度。帧率固定为 24fps。

- 计算：帧数 = 时长 × 24
- 取值范围：[29, 289] 内满足 `25 + 4n`（n 为正整数）的整数
- 示例：2.4 秒 → 帧数 = 57 → 实际时长 57/24 = 2.375 秒

与 `duration` 互斥，指定 `frames` 时忽略 `duration`。

#### seed `integer` (可选，默认 `-1`)

随机种子，取值范围 [-1, 2³²-1]。相同 seed 生成类似结果，但不保证完全一致。

#### camera_fixed `boolean` (可选，默认 `false`，参考图场景不支持)

| 值 | 说明 |
|----|------|
| `true` | 固定摄像头 |
| `false` | 不固定摄像头 |

#### watermark `boolean` (可选，默认 `false`)

| 值 | 说明 |
|----|------|
| `true` | 含水印 |
| `false` | 不含水印 |

### 请求示例

```bash
curl -X POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seedance-1-5-pro-251215",
    "content": [
      {
        "type": "text",
        "text": "小猫对着镜头打哈欠"
      }
    ],
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 5,
    "seed": 11,
    "camera_fixed": false,
    "watermark": false
  }'
```

### 响应参数

#### id `string`

视频生成任务 ID，保存 7 天后自动清除。用于后续轮询查询任务状态。

---

## 查询任务

`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}`

仅支持查询最近 7 天的任务。

### 请求参数

#### id `string` (必需，URL 路径参数)

待查询的任务 ID。

### 响应参数

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 任务 ID |
| `model` | string | 任务使用的模型 ID |
| `status` | string | 任务状态，见下方说明 |
| `error` | object / null | 任务成功时为 `null`，失败时包含 `code` 和 `message` |
| `created_at` | integer | 任务创建时间（Unix 时间戳，秒） |
| `updated_at` | integer | 状态最后更新时间（Unix 时间戳，秒） |
| `content.video_url` | string | 生成视频的下载地址（mp4），有效期 24 小时 |
| `content.last_frame_url` | string | 视频尾帧图像地址，有效期 24 小时。仅 `return_last_frame: true` 时返回 |
| `seed` | integer | 实际使用的种子值 |
| `resolution` | string | 生成视频的分辨率 |
| `ratio` | string | 生成视频的宽高比 |
| `duration` | integer | 生成视频时长（秒）。与 `frames` 二选一返回 |
| `frames` | integer | 生成视频帧数。与 `duration` 二选一返回 |
| `framespersecond` | integer | 生成视频帧率 |
| `generate_audio` | boolean | 是否包含同步音频。仅 Seedance 1.5 pro 返回 |
| `usage.completion_tokens` | integer | 输出视频消耗的 token 数 |
| `usage.total_tokens` | integer | 总消耗 token 数（等于 `completion_tokens`，不计输入） |

**status 枚举值：**

| 值 | 说明 |
|----|------|
| `queued` | 排队中 |
| `running` | 生成中 |
| `succeeded` | 已完成 |
| `failed` | 已失败 |
| `cancelled` | 已取消（24h 后自动删除，仅排队中可取消） |
| `expired` | 已超时 |

### 响应示例

```json
{
    "id": "cgt-2025****-****",
    "model": "doubao-seedance-1-5-pro-251215",
    "status": "succeeded",
    "content": {
        "video_url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/****"
    },
    "usage": {
        "completion_tokens": 246840,
        "total_tokens": 246840
    },
    "created_at": 1765510475,
    "updated_at": 1765510559,
    "seed": 58944,
    "resolution": "1080p",
    "ratio": "16:9",
    "duration": 5,
    "framespersecond": 24,
    "generate_audio": true
}
```
