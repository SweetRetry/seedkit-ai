# Seedream 图像生成 API 参考

## 模型

| 模型 | Doubao-Seedream-5.0-lite | Doubao-Seedream-4.5 | Doubao-Seedream-4.0 |
|------|--------------------------|-------------------|-------------------|
| Model ID | doubao-seedream-5-0-260128<br>(同时支持: doubao-seedream-5-0-lite-260128) | doubao-seedream-4-5-251128 | doubao-seedream-4-0-250828 |
| 文生图 | ✓ | ✓ | ✓ |
| 文生组图 | ✓ | ✓ | ✓ |
| 单/多图生图 | ✓ | ✓ | ✓ |
| 单/多图生组图 | ✓ | ✓ | ✓ |
| 流式输出 | ✓ | ✓ | ✓ |
| 联网搜索 | ✓ | ✗ | ✗ |
| **分辨率** | 2K, 3K | 2K, 4K | 1K, 2K, 4K |
| **输出格式** | png, jpeg | jpeg | jpeg |
| **提示词优化模式** | 标准模式 | 标准模式 | 标准模式, 极速模式 |
| **生成数量** | 输入参考图 + 最终图片 ≤ 15张 | - | - |
| **限流 (IPM)** | 500张/分钟 | 500张/分钟 | 500张/分钟 |

---

## 基础用法

### 文生图

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "充满活力的特写编辑肖像，模特眼神犀利，头戴雕塑感帽子，色彩拼接丰富，眼部焦点锐利，景深较浅，具有Vogue杂志封面的美学风格，采用中画幅拍摄，工作室灯光效果强烈。",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

### 图文生图（单图输入）

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "保持模特姿势和液态服装的流动形状不变。将服装材质从银色金属改为完全透明的清水（或玻璃）。透过液态水流，可以看到模特的皮肤细节。光影从反射变为折射。",
    "image": "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imageToimage.png",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

### 多图融合

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "将图1的服装换为图2的服装",
    "image": ["https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_imagesToimage_1.png", "https://ark-project.tos-cn-beijing.volces.com/doc_image/seedream4_5_imagesToimage_2.png"],
    "sequential_image_generation": "disabled",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

### 组图输出

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "生成一组共4张连贯插画，核心为同一庭院一角的四季变迁，以统一风格展现四季独特色彩、元素与氛围",
    "sequential_image_generation": "auto",
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

---

## 进阶用法

### 联网搜索

通过设置 `tools[].type` 为 `web_search` 开启联网搜索（仅 Seedream 5.0 lite 支持）。模型根据提示词自主判断是否检索互联网内容。实际搜索次数可通过 `usage.tool_usage.web_search` 字段查询。

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "制作一张上海未来5日的天气预报图，采用现代扁平化插画风格，清晰展示每日天气、温度和穿搭建议",
    "tools": [{"type": "web_search"}],
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

### 流式输出

设置 `stream: true` 开启流式输出，每张图片生成完毕后立即返回，无需等待全部完成。

```bash
curl https://ark.cn-beijing.volces.com/api/v3/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -d '{
    "model": "doubao-seedream-5-0-260128",
    "prompt": "生成一个美丽的风景画",
    "stream": true,
    "size": "2K",
    "output_format":"png",
    "watermark": false
}'
```

### 提示词优化模式

通过 `optimize_prompt_options.mode` 控制提示词优化策略：

| 模式 | 值 | 支持模型 | 说明 |
|------|----|---------|------|
| 标准模式 | `standard` | 全部 | 质量优先 |
| 极速模式 | `fast` | Seedream 4.0 | 速度优先，质量略降 |

---

## 请求参数

### size（图像尺寸）

支持两种方式，不可混用。

**方式 1：指定分辨率档位**

在 `prompt` 中用自然语言描述宽高比或用途，模型自动决定具体尺寸。

| 档位 | Seedream 5.0 lite | Seedream 4.5 | Seedream 4.0 |
|------|:-----------------:|:------------:|:------------:|
| `1K` | ✗ | ✗ | ✓ |
| `2K` | ✓ | ✓ | ✓ |
| `3K` | ✓ | ✗ | ✗ |
| `4K` | ✗ | ✓ | ✓ |

```json
{ "size": "2K" }
```

**方式 2：指定宽高像素值**

- 默认值：`2048x2048`
- 宽高比范围：[1/16, 16]
- 总像素范围：
  - Seedream 5.0 lite：3,686,400 ~ 10,404,496（2560x1440 ~ 3072x3072）
  - Seedream 4.5：3,686,400 ~ 16,777,216（2560x1440 ~ 4096x4096）
  - Seedream 4.0：921,600 ~ 16,777,216（1280x720 ~ 4096x4096）

```json
{ "size": "2048x2048" }
```

### 推荐宽高像素值

| 模型 | 1K | 2K | 3K | 4K |
|------|----|----|----|----|
| **Seedream 5.0 lite** | - | 2048x2048, 1728x2304, 2304x1728, 2848x1600, 1600x2848, 2496x1664, 1664x2496, 3136x1344 | 3072x3072, 2592x3456, 3456x2592, 4096x2304, 2304x4096, 2496x3744, 3744x2496, 4704x2016 | - |
| **Seedream 4.5** | - | 2048x2048, 1728x2304, 2304x1728, 2848x1600, 1600x2848, 2496x1664, 1664x2496, 3136x1344 | - | 4096x4096, 3520x4704, 4704x3520, 5504x3040, 3040x5504, 3328x4992, 4992x3328, 6240x2656 |
| **Seedream 4.0** | 1024x1024, 864x1152, 1152x864, 1312x736, 736x1312, 832x1248, 1248x832, 1568x672 | 2048x2048, 1728x2304, 2304x1728, 2848x1600, 1600x2848, 2496x1664, 1664x2496, 3136x1344 | - | 4096x4096, 3520x4704, 4704x3520, 5504x3040, 3040x5504, 3328x4992, 4992x3328, 6240x2656 |

### response_format（返回方式）

| 值 | 说明 |
|----|------|
| `url` | 返回图片下载链接 |
| `b64_json` | 返回 Base64 编码的 JSON 数据 |

```json
{ "response_format": "url" }
```

### output_format（文件格式）

- **Seedream 5.0 lite**：支持 `png` / `jpeg`
- **Seedream 4.5 / 4.0**：固定为 `jpeg`，不可配置

```json
{ "output_format": "png" }
```

### watermark（水印）

| 值 | 说明 |
|----|------|
| `true` | 添加水印 |
| `false` | 不添加水印（默认） |

```json
{ "watermark": false }
```

---

## 响应示例

```json
{
    "created": 1234567890,
    "data": [
        {
            "url": "https://example.com/generated-image.png"
        }
    ]
}
```
