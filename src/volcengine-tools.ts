import { webSearch } from "./tool/web-search";

/**
 * Volcengine provider tools.
 *
 * @example
 * ```ts
 * import { volcengine, volcengineTools } from "ai-sdk-volcengine-adapter";
 * import { generateText } from "ai";
 *
 * const result = await generateText({
 *   model: volcengine("doubao-seed-1-8-251228"),
 *   tools: {
 *     web_search: volcengineTools.webSearch(),
 *   },
 *   prompt: "What is the weather in Hangzhou today?",
 * });
 * ```
 */
export const volcengineTools = {
  /**
   * Web Search tool for retrieving up-to-date information from the internet.
   *
   * The tool must be named `web_search` in the tools object.
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
  webSearch,
};
