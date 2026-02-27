# Responses API 参考

`POST https://ark.cn-beijing.volces.com/api/v3/responses`

---

## 创建响应

### 请求参数

#### model `string` (必需)

调用的模型 ID，见[模型列表](https://www.volcengine.com/docs/82379/1330310)。

#### input `string | array` (必需)

输入给模型的内容。

**简写形式（纯文本）**

```json
{ "input": "你好" }
```

**完整形式（消息数组）**

每个元素为一条消息：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `role` | string | ✓ | `user` / `assistant` / `system` / `developer` |
| `content` | string \| array | ✓ | 消息内容，见下方内容类型 |
| `type` | string | ✓ | 固定为 `message` |
| `partial` | boolean | | 续写模式开关，仅最后一条 `assistant` 消息可用 |

**content 内容类型**

文本：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `input_text` |
| `text` | string | 文本内容 |

图片：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `input_image` |
| `image_url` | string | 图片 URL 或 `data:image/<格式>;base64,<内容>` |
| `detail` | string | 理解精细度：`low` / `high` / `xhigh` |
| `image_pixel_limit.max_pixels` | integer | 图片最大像素，超出则等比缩小 |
| `image_pixel_limit.min_pixels` | integer | 图片最小像素，不足则等比放大 |

视频：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `input_video` |
| `video_url` | string | 视频 URL 或 base64 |
| `fps` | float | 抽帧频率，范围 [0.2, 5] |

文件（PDF）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `input_file` |
| `file_data` | string | 文件 Base64 内容，单文件 ≤ 50 MB |
| `file_url` | string | 文件可访问 URL，≤ 50 MB |
| `filename` | string | 文件名，使用 `file_data` 时必填 |

**上下文元素（用于多轮对话手动管理）**

工具调用记录（function_call）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `function_call` |
| `call_id` | string | 模型生成的工具调用唯一 ID |
| `name` | string | 函数名称 |
| `arguments` | string | 参数 JSON 字符串 |

工具返回结果（function_call_output）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `function_call_output` |
| `call_id` | string | 对应的工具调用 ID |
| `output` | string | 工具返回结果 |

思维链（reasoning，用于手动管理多轮对话的 CoT 上下文）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `reasoning` |
| `id` | string | 思维链唯一标识 |
| `summary[].type` | string | 固定为 `summary_text` |
| `summary[].text` | string | 思维链文本内容 |

---

#### instructions `string | null` (可选)

在上下文头部插入系统/开发者消息。

#### stream `boolean | null` (可选，默认 `false`)

| 值 | 说明 |
|----|------|
| `false` | 生成完毕后一次性返回 |
| `true` | 按 SSE 协议流式返回，以 `data: [DONE]` 结束 |

#### temperature `float | null` (可选，默认 `1`)

采样温度，范围 [0, 2]。值越高输出越随机，值越低越确定。建议不与 `top_p` 同时调整。

> `doubao-seed-2-0-pro` / `doubao-seed-2-0-lite` 系列固定为 `1`，手动设置无效。

#### top_p `float | null` (可选，默认 `0.7`)

核采样阈值，范围 [0, 1]。建议不与 `temperature` 同时调整。

> `doubao-seed-2-0-pro` / `doubao-seed-2-0-lite` 系列固定为 `0.95`，手动设置无效。

#### max_output_tokens `integer | null` (可选)

最大输出 token 数，包含思维链和回答内容。

#### thinking `object` (可选)

控制深度思考模式。

| `thinking.type` | 说明 | 支持模型 |
|-----------------|------|---------|
| `enabled` | 强制开启思考 | 见下方表格 |
| `disabled` | 强制关闭思考 | 见下方表格 |
| `auto` | 模型自主判断是否思考 | 仅 doubao-seed-1-6-250615 |

**各模型支持的 thinking.type：**

| 模型 | enabled | disabled | auto |
|------|:-------:|:--------:|:----:|
| doubao-seed-2-0-pro-260215 | ✓（默认） | ✓ | |
| doubao-seed-2-0-lite-260215 | ✓（默认） | ✓ | |
| doubao-seed-2-0-mini-260215 | ✓（默认） | ✓ | |
| doubao-seed-2-0-code-preview-260215 | ✓（默认） | ✓ | |
| doubao-seed-1-8-251228 | ✓（默认） | ✓ | |
| doubao-seed-code-preview-251028 | ✓（默认） | ✓ | |
| doubao-seed-1-6-vision-250815 | ✓（默认） | ✓ | |
| doubao-seed-1-6-251015 | ✓（默认） | ✓ | |
| doubao-seed-1-6-lite-251015 | ✓（默认） | ✓ | |
| doubao-seed-1-6-flash-250828 | ✓（默认） | ✓ | |
| doubao-seed-1-6-flash-250715 | ✓（默认） | ✓ | |
| doubao-seed-1-6-flash-250615 | ✓（默认） | ✓ | |
| doubao-seed-1-6-250615 | ✓（默认） | ✓ | ✓ |
| glm-4-7-251222 | ✓（默认） | ✓ | |
| deepseek-v3-2-251201 | ✓ | ✓（默认） | |
| deepseek-v3-1-terminus | ✓ | ✓（默认） | |
| deepseek-v3-1-250821 | ✓ | ✓（默认） | |

#### reasoning `object` (可选，默认 `{"effort": "medium"}`)

调节思考深度，仅在 `thinking.type` 为 `enabled` 时有效。

| `reasoning.effort` | 说明 |
|--------------------|------|
| `minimal` | 关闭思考，直接回答 |
| `low` | 轻量思考，侧重快速响应 |
| `medium` | 均衡模式（默认） |
| `high` | 深度分析，处理复杂问题 |

支持 `reasoning.effort` 的模型：doubao-seed-2-0-pro/lite/mini/code-preview、doubao-seed-1-8、doubao-seed-1-6-251015、doubao-seed-1-6-lite-251015。

#### text `object` (可选)

指定输出格式。

**纯文本（默认）：**
```json
{ "text": { "format": { "type": "text" } } }
```

**JSON Object：**
```json
{ "text": { "format": { "type": "json_object" } } }
```

**JSON Schema（推荐）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `text.format.type` | string | 固定为 `json_schema` |
| `text.format.name` | string | Schema 名称 |
| `text.format.schema` | object | JSON Schema 对象 |
| `text.format.description` | string | 输出用途描述 |
| `text.format.strict` | boolean | `true` 时严格遵循 schema，默认 `false` |

#### tools `array` (可选)

模型可调用的工具列表。

**Function Calling（自定义函数）：**

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | string | ✓ | 固定为 `function` |
| `name` | string | ✓ | 函数名称 |
| `description` | string | | 函数描述，模型据此判断是否调用 |
| `parameters` | object | | JSON Schema 格式的参数定义 |
| `strict` | boolean | | 是否强制参数验证，默认 `true` |

**联网搜索（web_search）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 固定为 `web_search` |
| `limit` | integer | 单轮最大召回条数，范围 [1, 50]，默认 10 |
| `max_keyword` | integer | 最大并行搜索关键词数，范围 [1, 50] |
| `sources` | string[] | 附加内容源：`toutiao` / `douyin` / `moji` |
| `user_location.type` | string | 固定为 `approximate` |
| `user_location.country` | string | 国家 |
| `user_location.region` | string | 省/州 |
| `user_location.city` | string | 城市 |

#### tool_choice `string | object` (可选)

> 仅 `doubao-seed-1-6-***` 系列支持。

| 值 | 说明 |
|----|------|
| `auto` | 模型自行判断（有工具时默认） |
| `none` | 不调用工具（无工具时默认） |
| `required` | 必须调用工具 |
| `{"type": "function", "name": "函数名"}` | 指定调用特定函数 |

#### max_tool_calls `integer` (可选)

最大工具调用轮次，范围 [1, 10]。达到上限后模型停止工具调用直接回答。

---

### 请求示例

**文本生成**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": "你好，介绍一下自己"
  }'
```

**多轮对话**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": [
      {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "讲个笑话"}]},
      {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "为什么程序员不喜欢户外活动？因为 bug 太多了。"}]},
      {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "这个笑话的笑点在哪？"}]}
    ]
  }'
```

**流式输出**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": "常见的十字花科植物有哪些？",
    "stream": true
  }'
```

**图片理解**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": [
      {
        "role": "user",
        "content": [
          {
            "type": "input_image",
            "file_id": "file-20251018****"
          },
          {
            "type": "input_text",
            "text": "描述这张图片的内容"
          }
        ]
      }
    ]
  }'
```

**深度思考**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": "推理模型与非推理模型的区别",
    "thinking": { "type": "enabled" },
    "reasoning": { "effort": "high" },
    "stream": true
  }'
```

**结构化输出（json_schema）**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": [
      {
        "role": "user",
        "content": [{ "type": "input_text", "text": "解方程 8x + 7 = -23，用 JSON 格式输出步骤" }]
      }
    ],
    "thinking": { "type": "disabled" },
    "text": {
      "format": {
        "type": "json_schema",
        "name": "math_reasoning",
        "strict": true,
        "schema": {
          "type": "object",
          "properties": {
            "steps": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "explanation": { "type": "string" },
                  "output": { "type": "string" }
                },
                "required": ["explanation", "output"],
                "additionalProperties": false
              }
            },
            "final_answer": { "type": "string" }
          },
          "required": ["steps", "final_answer"],
          "additionalProperties": false
        }
      }
    }
  }'
```

**Function Calling**

```bash
curl https://ark.cn-beijing.volces.com/api/v3/responses \
  -H "Authorization: Bearer $ARK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "doubao-seed-1-6-251015",
    "input": "北京今天天气怎么样？",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "获取指定城市的天气信息",
        "parameters": {
          "type": "object",
          "properties": {
            "city": { "type": "string", "description": "城市名称" }
          },
          "required": ["city"]
        }
      }
    ]
  }'
```

---

### 响应参数

非流式调用返回 response object；流式调用见下方[流式事件](#流式事件)。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 响应唯一 ID |
| `status` | string | `completed` / `incomplete` / `failed` |
| `output` | array | 模型输出内容列表 |
| `output[].type` | string | `message` / `reasoning` / `function_call` |
| `output[].role` | string | 固定为 `assistant` |
| `output[].content[].type` | string | `output_text` |
| `output[].content[].text` | string | 模型输出文本 |
| `usage.input_tokens` | integer | 输入 token 数 |
| `usage.output_tokens` | integer | 输出 token 数（含思维链） |
| `usage.total_tokens` | integer | 总 token 数 |

---

## 查询响应

`GET https://ark.cn-beijing.volces.com/api/v3/responses/{response_id}`

仅支持查询已完成的响应。

### 请求参数

| 字段 | 位置 | 必需 | 说明 |
|------|------|------|------|
| `response_id` | URL 路径 | ✓ | 待查询的响应 ID |

### 响应

返回与创建响应相同结构的 response object。

---

## 流式事件

开启 `stream: true` 后，服务端通过 SSE 推送以下事件序列：

| 事件类型 | 触发时机 |
|----------|---------|
| `response.created` | 响应对象创建时 |
| `response.in_progress` | 响应生成进行中 |
| `response.output_item.added` | 新增输出项（文本块/思维链/工具调用） |
| `response.content_part.added` | 新增内容部分 |
| `response.output_text.delta` | 文本增量片段 |
| `response.output_text.done` | 文本内容完成 |
| `response.reasoning_summary_part.added` | 思维链新增部分 |
| `response.reasoning_summary_text.delta` | 思维链增量文本 |
| `response.reasoning_summary_text.done` | 思维链文本完成 |
| `response.function_call_arguments.delta` | 函数调用参数增量 |
| `response.function_call_arguments.done` | 函数调用参数完成 |
| `response.content_part.done` | 内容部分完成 |
| `response.output_item.done` | 输出项完成 |
| `response.completed` | 响应正常完成 |
| `response.incomplete` | 响应以未完成状态结束 |
| `response.failed` | 响应失败 |
| `error` | 发生错误 |

**每个事件的公共字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | string | 事件类型名称 |
| `sequence_number` | integer | 事件序列号，用于排序 |

**delta 事件额外字段（output_text.delta / reasoning_summary_text.delta）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `delta` | string | 新增文本片段 |
| `item_id` | string | 所属输出项 ID |
| `output_index` | integer | 所属输出项的列表索引 |
| `content_index` | integer | 所属内容块的索引 |

**error 事件字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string / null | 错误码 |
| `message` | string | 错误原因 |
| `param` | string / null | 出错的参数名 |
