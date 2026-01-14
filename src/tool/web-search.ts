import {
  createProviderToolFactory,
  lazySchema,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod";

/**
 * User location for optimizing search results.
 */
const userLocationSchema = z.object({
  /**
   * Location type.
   * @default "approximate"
   */
  type: z.enum(["approximate"]).default("approximate"),
  /**
   * Country name (e.g., "中国").
   */
  country: z.string().optional(),
  /**
   * Region/Province name (e.g., "浙江").
   */
  region: z.string().optional(),
  /**
   * City name (e.g., "杭州").
   */
  city: z.string().optional(),
});

export interface WebSearchInput {
  maxKeyword?: number;
  limit?: number;
  maxToolCalls?: number;
  sources?: string[];
  userLocation?: {
    type?: "approximate";
    country?: string;
    region?: string;
    city?: string;
  };
}

/**
 * Volcengine Web Search Tool
 *
 * Enables the model to perform web searches to retrieve up-to-date information.
 *
 * @see https://www.volcengine.com/docs/82379/1756990
 */
export const webSearch = createProviderToolFactory<
  WebSearchInput,
  WebSearchInput
>({
  id: "volcengine.web_search",
  inputSchema: lazySchema(() =>
    zodSchema(
      z.object({
        maxKeyword: z.number().min(1).max(50).optional(),
        limit: z.number().min(1).max(50).default(10),
        maxToolCalls: z.number().min(1).max(10).default(3),
        sources: z.array(z.string()).optional(),
        userLocation: userLocationSchema.optional(),
      })
    )
  ),
});
