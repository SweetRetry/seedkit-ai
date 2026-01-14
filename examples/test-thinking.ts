import { config } from "dotenv";
import { createVolcengine } from "ai-sdk-volcengine-adapter";
import { generateText, streamText } from "ai";
import { writeFileSync, appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

// 加载 .env.local 文件
config({ path: ".env.local" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "output");
mkdirSync(OUTPUT_DIR, { recursive: true });
const OUTPUT_FILE = join(OUTPUT_DIR, "test-thinking-output.txt");

const volcengine = createVolcengine({
  apiKey: process.env.ARK_API_KEY,
});



function log(message: string) {
  console.log(message);
  appendFileSync(OUTPUT_FILE, message + "\n");
}

function write(message: string) {
  process.stdout.write(message);
  appendFileSync(OUTPUT_FILE, message);
}


async function testThinkingStream() {
  log("\n=== 测试 streamText with thinking ===\n");

  try {
    const result = streamText({
      model: volcengine("doubao-seed-1-8-251228"),
      prompt: "解释为什么天空是蓝色的？",
      providerOptions: {
        volcengine: {
          thinking: true,
        },
      },
    });

    log("--- Streaming Response ---\n");

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-start":
          log("[Reasoning Start - ID: " + part.id + "]");
          break;
        case "reasoning-delta":
          write(part.text);
          break;
        case "reasoning-end":
          log("\n[Reasoning End]\n");
          break;
        case "text-start":
          log("[Text Start - ID: " + part.id + "]");
          break;
        case "text-delta":
          write(part.text);
          break;
        case "text-end":
          log("\n[Text End]\n");
          break;
        case "finish":
          log("--- Finish ---");
          log("Finish Reason: " + part.finishReason);
          log("Usage: " + JSON.stringify(part.totalUsage, null, 2));
          break;
        case "error":
          log("Stream Error: " + String(part.error));
          break;
      }
    }
  } catch (error) {
    log("Error: " + String(error));
  }
}

async function testThinkingDisabledGenerate() {
  log("=== 测试 generateText with thinking DISABLED ===\n");

  try {
    const result = await generateText({
      model: volcengine("doubao-seed-1-8-251228"),
      prompt: "计算 5 + 3 等于多少？",
      providerOptions: {
        volcengine: {
          thinking: false,
        },
      },
    });

    log("--- Response Content ---");
    let hasReasoning = false;
    for (const part of result.content) {
      if (part.type === "reasoning") {
        hasReasoning = true;
        log("\n[Reasoning Content] (UNEXPECTED!):");
        log(part.text);
      } else if (part.type === "text") {
        log("\n[Text Content]:");
        log(part.text);
      }
    }

    if (!hasReasoning) {
      log("\n[OK] No reasoning content returned (thinking disabled correctly)");
    } else {
      log("\n[FAIL] Reasoning content was returned despite thinking being disabled!");
    }

    log("\n--- Usage ---");
    log(JSON.stringify(result.usage, null, 2));

    log("\n--- Finish Reason ---");
    log(result.finishReason);
  } catch (error) {
    log("Error: " + String(error));
  }
}

async function testThinkingDisabledStream() {
  log("\n=== 测试 streamText with thinking DISABLED ===\n");

  try {
    const result = streamText({
      model: volcengine("doubao-seed-1-8-251228"),
      prompt: "1 + 1 等于多少？",
      providerOptions: {
        volcengine: {
          thinking: false,
        },
      },
    });

    log("--- Streaming Response ---\n");

    let hasReasoning = false;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "reasoning-start":
          hasReasoning = true;
          log("[Reasoning Start - ID: " + part.id + "] (UNEXPECTED!)");
          break;
        case "reasoning-delta":
          write(part.text);
          break;
        case "reasoning-end":
          log("\n[Reasoning End]\n");
          break;
        case "text-start":
          log("[Text Start - ID: " + part.id + "]");
          break;
        case "text-delta":
          write(part.text);
          break;
        case "text-end":
          log("\n[Text End]\n");
          break;
        case "finish":
          log("--- Finish ---");
          log("Finish Reason: " + part.finishReason);
          log("Usage: " + JSON.stringify(part.totalUsage, null, 2));
          break;
        case "error":
          log("Stream Error: " + String(part.error));
          break;
      }
    }

    if (!hasReasoning) {
      log("[OK] No reasoning content in stream (thinking disabled correctly)");
    } else {
      log("[FAIL] Reasoning content was streamed despite thinking being disabled!");
    }
  } catch (error) {
    log("Error: " + String(error));
  }
}

async function main() {
  // 初始化输出文件
  writeFileSync(OUTPUT_FILE, `Thinking Feature Test - ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`);

  // 检查 API Key
  if (!process.env.ARK_API_KEY) {
    log("Error: ARK_API_KEY environment variable is not set");
    log("Please set your Volcengine API key:");
    log("  export ARK_API_KEY=your-api-key");
    process.exit(1);
  }

  log("Starting thinking feature test...\n");

  // 测试开启 thinking 的流式生成
  await testThinkingStream();

  log("\n" + "=".repeat(60) + "\n");

  // 测试关闭 thinking 的非流式生成
  await testThinkingDisabledGenerate();

  log("\n" + "=".repeat(60) + "\n");

  // 测试关闭 thinking 的流式生成
  await testThinkingDisabledStream();

  log("\n\nTest completed!");
  log(`\nOutput saved to: ${OUTPUT_FILE}`);
}

main();
