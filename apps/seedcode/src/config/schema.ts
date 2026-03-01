import { z } from 'zod';

export const PLANS = ['api', 'coding'] as const;
export type Plan = typeof PLANS[number];

export const PLAN_PRESETS: Record<Plan, { baseURL: string; model: string }> = {
  api: { baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-8-251228' },
  coding: { baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3', model: 'doubao-seed-2.0-code' },
};

export const ConfigSchema = z.object({
  apiKey: z.string().optional(),
  model: z.string().default('doubao-seed-1-8-251228'),
  thinking: z.boolean().default(false),
  plan: z.enum(PLANS).default('api'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_MODEL = 'doubao-seed-1-8-251228';
