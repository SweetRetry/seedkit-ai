import {
  createProviderToolFactoryWithOutputSchema,
  lazySchema,
  zodSchema,
} from "@ai-sdk/provider-utils";
import { z } from "zod/v4";

const userLocationSchema = z
  .object({
    type: z.enum(["approximate"]).optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    city: z.string().optional(),
  })
  .strict();

export const webSearchArgsSchema = lazySchema(() =>
  zodSchema(
    z
      .object({
        maxKeyword: z.number().int().min(1).max(50).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        maxToolCalls: z.number().int().min(1).max(10).optional(),
        sources: z.array(z.string()).optional(),
        userLocation: userLocationSchema.optional(),
      })
      .strict()
  )
);

const webSearchInputSchema = lazySchema(() => zodSchema(z.object({})));

export const webSearchOutputSchema = lazySchema(() =>
  zodSchema(z.object({ result: z.string() }))
);

/**
 * Web search input options.
 */
export interface WebSearchArgs {
  /**
   * Maximum number of keywords to extract from the query.
   */
  maxKeyword?: number;

  /**
   * Maximum number of search results to return.
   * @default 10
   */
  limit?: number;

  /**
   * Maximum number of tool calls.
   * @default 3
   */
  maxToolCalls?: number;

  /**
   * Sources to search from (e.g., "douyin", "toutiao").
   */
  sources?: string[];

  /**
   * User location for optimizing search results.
   */
  userLocation?: {
    /**
     * Location type.
     * @default "approximate"
     */
    type?: "approximate";
    /**
     * Country name (e.g., "中国").
     */
    country?: string;
    /**
     * Region/Province name (e.g., "浙江").
     */
    region?: string;
    /**
     * City name (e.g., "杭州").
     */
    city?: string;
  };
}

const webSearchToolFactory = createProviderToolFactoryWithOutputSchema<
  {},
  {
    /**
     * The search result.
     */
    result: string;
  },
  WebSearchArgs
>({
  id: "volcengine.web_search",
  inputSchema: webSearchInputSchema,
  outputSchema: webSearchOutputSchema,
});

/**
 * Volcengine Web Search Tool
 *
 * Enables the model to perform web searches to retrieve up-to-date information.
 *
 * @see https://www.volcengine.com/docs/82379/1756990
 *
 * @example
 * ```ts
 * volcengineTools.webSearch({
 *   maxKeyword: 5,
 *   limit: 20,
 *   sources: ["douyin", "toutiao"],
 *   userLocation: {
 *     type: "approximate",
 *     country: "中国",
 *     region: "浙江",
 *     city: "杭州",
 *   },
 * })
 * ```
 */
export const webSearch = (args: WebSearchArgs = {}) => {
  return webSearchToolFactory(args);
};
