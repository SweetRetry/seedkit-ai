# AI SDK Volcengine Adapter

[Volcengine](https://www.volcengine.com/) (Doubao) provider for the [AI SDK](https://sdk.vercel.ai/).

## Installation

```bash
npm install @sweetretry/ai-sdk-volcengine-adapter
```

## Setup

Set your Volcengine API key as an environment variable:

```bash
export ARK_API_KEY=your-api-key
```

Or pass it directly when creating the provider:

```typescript
import { createVolcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const volcengine = createVolcengine({
  apiKey: 'your-api-key',
});
```

## Usage

### Basic Text Generation

```typescript
import { generateText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const { text } = await generateText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'What is the meaning of life?',
});

console.log(text);
```

### Streaming

```typescript
import { streamText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const result = streamText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'Write a short story about a robot.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Extended Thinking Mode

Enable extended thinking to get reasoning content from the model:

```typescript
import { streamText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const result = streamText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'Solve this step by step: What is 23 * 47?',
  providerOptions: {
    volcengine: {
      thinking: true,
    },
  },
});

for await (const part of result.fullStream) {
  if (part.type === 'reasoning-delta') {
    process.stdout.write(`[Thinking] ${part.text}`);
  } else if (part.type === 'text-delta') {
    process.stdout.write(part.text);
  }
}
```

### PDF File Support

You can include PDF files in your messages:

```typescript
import { generateText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';
import fs from 'fs';

const pdfBuffer = fs.readFileSync('document.pdf');

const { text } = await generateText({
  model: volcengine('doubao-seed-1-6-vision-250815'),
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          data: pdfBuffer,
          mimeType: 'application/pdf',
        },
        {
          type: 'text',
          text: 'Summarize this PDF document.',
        },
      ],
    },
  ],
});
```

### Image Generation

Generate images using Volcengine's image models:

```typescript
import { generateImage } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const { images } = await generateImage({
  model: volcengine.image('doubao-seedream-4-5-251128'),
  prompt: 'A beautiful sunset over mountains',
  size: '1024x1024',
});

// images[0] contains the base64 encoded image
```

### Tool Calling

```typescript
import { generateText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';
import { z } from 'zod';

const { text, toolCalls } = await generateText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'What is the weather in San Francisco?',
  tools: {
    getWeather: {
      description: 'Get the weather for a location',
      parameters: z.object({
        location: z.string().describe('The city name'),
      }),
      execute: async ({ location }) => {
        return { temperature: 72, condition: 'sunny' };
      },
    },
  },
});
```

### Web Search Tool

Use the built-in web search tool:

```typescript
import { generateText } from 'ai';
import { volcengine, volcengineTools } from '@sweetretry/ai-sdk-volcengine-adapter';

const { text } = await generateText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'What are the latest news about AI?',
  tools: {
    webSearch: volcengineTools.webSearch(),
  },
});
```

## Supported Models

### Chat Models

- `doubao-seed-1-8-251228` - Latest Doubao Seed model
- `doubao-seed-code-preview-251028` - Code-optimized model
- `doubao-seed-1-6-lite-251015` - Lightweight model
- `doubao-seed-1-6-flash-250828` - Fast inference model
- `doubao-seed-1-6-vision-250815` - Vision-capable model (supports images and PDFs)

### Image Models

- `doubao-seedream-4-5-251128` - Latest Seedream image generation model
- `doubao-seedream-4-0-250828` - Seedream 4.0 model

You can also use any model ID string for custom endpoints.

## Provider Options

```typescript
import { createVolcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const volcengine = createVolcengine({
  // Custom base URL (default: https://ark.cn-beijing.volces.com/api/v3)
  baseURL: 'https://your-custom-endpoint.com/api/v3',

  // API key (default: ARK_API_KEY env variable)
  apiKey: 'your-api-key',

  // Custom headers
  headers: {
    'X-Custom-Header': 'value',
  },

  // Custom fetch implementation
  fetch: customFetch,
});
```

## Model Options

```typescript
import { generateText } from 'ai';
import { volcengine } from '@sweetretry/ai-sdk-volcengine-adapter';

const { text } = await generateText({
  model: volcengine('doubao-seed-1-8-251228'),
  prompt: 'Hello!',
  providerOptions: {
    volcengine: {
      // Enable extended thinking mode
      thinking: true,

      // Enable structured outputs
      structuredOutputs: true,

      // Enable strict JSON schema validation
      strictJsonSchema: false,

      // Enable parallel tool calls
      parallelToolCalls: true,
    },
  },
});
```

## License

MIT
