# Multiline Paste Bug Postmortem

> seedcode InputBox — 从终端原始字节到 React 状态的完整追踪

## 1. 现象

在 seedcode CLI 中复制粘贴两行或多行文本时，输入框行为异常：
- 显示乱码/光标错位
- 多行内容被挤在单行渲染
- 某些情况下第一行被直接提交，剩余内容丢失

## 2. 背景知识：终端 Raw Mode 下的字节语义

理解这个 bug 需要先理解终端在 raw mode 下如何表达"换行"。

### 2.1 三种换行字节

| 字节 | 十六进制 | 名称 | 来源 |
|------|----------|------|------|
| `\r` | `0x0D` | Carriage Return (CR) | 用户按 Enter 键；macOS 粘贴的行分隔符 |
| `\n` | `0x0A` | Line Feed (LF) | Unix 文本文件的行分隔符；部分终端的粘贴 |
| `\r\n` | `0x0D 0x0A` | CRLF | Windows 文本的行分隔符；Windows 终端粘贴 |

关键点：**用户按 Enter 和用户粘贴多行文本，终端发送的是相同的字节 `\r`**。区别在于：
- Enter：单独的 `\r`，作为一个独立事件到达
- 粘贴：`\r` 嵌在一个长字符串中间，和其他字符一起到达

### 2.2 ink 的输入处理管线

```
stdin.read()
    │
    ▼
input-parser.js ─── 按 ESC 序列分割，非 ESC 内容作为整块传递
    │
    ▼
parse-keypress.js ─── 对每个事件块做单字符精确匹配
    │
    ▼
use-input.js ─── 构造 (input, key) 参数，调用用户回调
    │
    ▼
InputBox useInput callback ─── 我们的代码
```

#### input-parser.js 的关键行为

```javascript
// input-parser.js:72-82
const parseKeypresses = (input) => {
    const events = [];
    let index = 0;
    while (index < input.length) {
        const escapeIndex = input.indexOf(escape, index); // escape = '\u001B'
        if (escapeIndex === -1) {
            events.push(input.slice(index)); // 整块推入，不按 \r 或 \n 分割
            return { events, pending: '' };
        }
        // ... 处理 ESC 序列
    }
};
```

它只在 ESC (`\x1B`) 处分割。普通文本（包括 `\r`、`\n`）作为一个完整字符串传递。

#### parse-keypress.js 的关键行为

```javascript
// parse-keypress.js:412-421
if (s === '\r' || s === '\x1b\r') {    // 精确匹配：只有当整个字符串 === '\r'
    key.name = 'return';
}
else if (s === '\n') {                  // 精确匹配：只有当整个字符串 === '\n'
    key.name = 'enter';
}
```

这里用的是 `===` 全等比较。当 `s = "line1\rline2"`（多字符粘贴）时，**所有特殊键分支都不匹配**，直接 fall through 到默认行为：`key.name = ''`。

#### use-input.js 的关键行为

```javascript
// use-input.js:89-98
if (keypress.ctrl) {
    input = keypress.name;
} else {
    input = keypress.sequence;  // ← 对于粘贴，这就是原始字符串 "line1\rline2"
}

if (nonAlphanumericKeys.includes(keypress.name)) {
    input = '';  // 不匹配，因为 keypress.name === ''
}
```

最终回调收到：`input = "line1\rline2"`, `key.return = false`。

## 3. Bug 的精确触发路径

### 场景 A：粘贴作为单块到达（主要场景）

```
用户粘贴 "hello\nworld"
    │
    ▼ macOS 终端将 \n 转为 \r
stdin 收到: "hello\rworld"
    │
    ▼ input-parser: 无 ESC → 整块传递
parseKeypress("hello\rworld")
    │
    ▼ 不匹配任何单字符规则
key.name = '', key.return = false
    │
    ▼ use-input
input = "hello\rworld", 所有 key flags = false
    │
    ▼ InputBox useInput callback (修复前)
```

在修复前的 `useInput` 回调中：

```typescript
// 所有特殊键检查都不匹配（key.return = false, key.upArrow = false, ...）
// 最终到达：
if (input) {
    update(val.slice(0, cur) + input + val.slice(cur), cur + input.length);
    //                         ^^^^^
    //                    "hello\rworld" — \r 被原封不动插入
}
```

此时 `value = "hello\rworld"`。但渲染代码：

```typescript
const isMultiline = value.includes('\n');  // false! 因为是 \r 不是 \n
```

结果：多行内容被当作单行渲染。`\r` (回车符) 在终端中的语义是"光标回到行首"，导致后半部分覆盖前半部分显示。

### 场景 B：粘贴被分包到达（偶发场景）

某些终端或网络延迟下，粘贴可能被拆成多个 stdin chunk：

```
chunk 1: "hello"  → input = "hello", key.return = false → 正常插入
chunk 2: "\r"     → input = "", key.return = true        → 触发 submit!
chunk 3: "world"  → 但此时 value 已被 reset，"hello" 已提交
```

第二行 "world" 会被当作全新输入的开头。

## 4. 修复方案

### 4.1 核心修复：一行代码

```typescript
useInput(
    (rawInput, key) => {
+       const input = normalizeLineEndings(rawInput);
        // ...
    }
);
```

```typescript
export function normalizeLineEndings(raw: string): string {
    return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
```

**替换顺序至关重要**：必须先替换 `\r\n` 再替换 `\r`。如果反过来：

```
"\r\n" → replace(\r, \n) → "\n\n" → replace(\r\n, \n) → "\n\n"  ← 错！一个换行变两个
"\r\n" → replace(\r\n, \n) → "\n" → replace(\r, \n) → "\n"      ← 对！
```

### 4.2 为什么不会影响 Enter 键？

用户按 Enter 时的数据流：

```
stdin: "\r" (单字节)
    │
    ▼ parseKeypress("\r")
key.name = 'return'  ← 精确匹配 s === '\r'
    │
    ▼ use-input.js
input = '' (因为 'return' ∈ nonAlphanumericKeys)
key.return = true
    │
    ▼ normalizeLineEndings('')
'' (空字符串，无变化)
    │
    ▼ InputBox: key.return === true → 走 submit 逻辑
```

`normalizeLineEndings` 对空字符串是 no-op，不影响 Enter 的语义。

### 4.3 为什么不会影响 `\` 续行？

用户输入 `hello\` 然后按 Enter：

```
key.return = true, input = ''
    │
    ▼ InputBox key.return handler:
if (val.endsWith('\\')) {
    const newVal = val.slice(0, -1) + '\n';  // 手动插入 \n
    update(newVal, newVal.length);
}
```

这里的 `\n` 是代码直接写入的，不经过 `normalizeLineEndings`。不受影响。

## 5. 附带重构：提取纯函数 + 测试覆盖

修复过程中，将 InputBox 中 6 个与 React 无关的纯计算函数提取到 `inputEditing.ts`：

| 函数 | 职责 | 测试数量 |
|------|------|----------|
| `normalizeLineEndings` | CR/CRLF → LF | 7 |
| `insertAtCursor` | 在光标位置插入文本 | 6 |
| `prevWordBoundary` / `nextWordBoundary` | 单词跳转 | 7 |
| `getCursorLineCol` | 多行光标定位 | 5 |
| `computeMultilineViewport` | 多行视口窗口计算 | 4 |
| `computeSingleLineViewport` | 单行水平滚动 | 3 |
| 集成测试 | normalize + insert 组合 | 3 |
| 既有测试 | `deleteLeftOfCursor` | 4 |
| **合计** | | **43** |

## 6. 经验教训

### 6.1 终端不是 Web — 没有标准化层

Web 浏览器的 `input` 事件已经帮你处理了换行符标准化。但在 raw mode 终端中，你拿到的就是原始字节。每个终端模拟器、每个操作系统、甚至同一个终端在"打字"和"粘贴"时，发送的字节可能不同。

**规则：任何处理终端输入的代码，第一步都应该做 line-ending normalization。**

### 6.2 ink 的 `useInput` 不是为多行编辑设计的

ink 的输入管线有两个对多行编辑不友好的设计：
1. `parseKeypress` 用 `===` 做全等匹配，只识别单字符控制序列
2. 粘贴文本中的 `\r` 不会被标记为 `key.return`，而是作为 `input` 的一部分原样传递

这不是 bug — ink 主要面向单行命令输入场景。但如果你要用 ink 构建多行编辑器，必须在 `useInput` 回调的最前面加一层标准化。

### 6.3 "修复一行但理解需要一百行"

最终的 fix 是一行 `normalizeLineEndings(rawInput)`。但要确认这一行是正确的、充分的、不会引入回归的，需要：
1. 阅读 ink 的 4 个核心模块（input-parser → parse-keypress → use-input → App）
2. 追踪 `\r`、`\n`、`\r\n` 在每一层的行为
3. 验证 Enter 键、`\` 续行、Ctrl+C 等所有使用 `input` 参数的分支不受影响
4. 编写 43 个测试用例覆盖边界条件

这就是为什么 debug 需要时间，但 fix 只有一行。

## 7. 相关文件

```
apps/seedcode/src/ui/
├── inputEditing.ts          ← 纯函数模块（+142 行）
├── inputEditing.test.ts     ← 43 个测试用例（重写）
├── InputBox.tsx             ← 应用修复 + 使用提取的函数（-68 行）
└── pickers/                 ← 同期重构提取的选择器组件
    ├── ListPicker.tsx
    ├── ModelPicker.tsx
    ├── ResumePicker.tsx
    └── MemoryPicker.tsx
```
