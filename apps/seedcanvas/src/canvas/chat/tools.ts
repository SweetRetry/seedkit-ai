import { createSeed } from "@seedkit-ai/ai-sdk-provider"
import { readFile, readTextFile } from "@tauri-apps/plugin-fs"
import { generateText, tool } from "ai"
import { z } from "zod"
import { useCanvasStore } from "@/canvas/store"
import type { CanvasEdge, CanvasNode, HistoryEntry, HistoryResult } from "@/canvas/types"
import { generateId } from "@/lib/id"
import type { AppSettings } from "@/lib/settings"

function getStore() {
  return useCanvasStore.getState()
}

// ---------------------------------------------------------------------------
// History serialization — make results LLM-readable
// ---------------------------------------------------------------------------

function serializeResult(result: HistoryResult): Record<string, unknown> {
  switch (result.type) {
    case "text":
      return { type: "text", content: result.content }
    case "image":
      return {
        type: "image",
        description: `Image (${result.width}×${result.height})`,
        width: result.width,
        height: result.height,
        hint: "Use read_media tool with this node's id to get a text description of the image.",
      }
    case "video":
      return {
        type: "video",
        description: `Video (${result.width}×${result.height})`,
        width: result.width,
        height: result.height,
        hint: "Video content cannot be analyzed directly.",
      }
  }
}

function serializeHistory(h: HistoryEntry) {
  return {
    id: h.id,
    result: serializeResult(h.result),
    source: (h.parameters as Record<string, unknown>).source ?? null,
    createdAt: h.createdAt,
  }
}

// ---------------------------------------------------------------------------
// MIME detection — magic bytes (ported from @seedkit-ai/tools)
// ---------------------------------------------------------------------------

const MAGIC: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46], mime: "image/gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" },
  { bytes: [0x42, 0x4d], mime: "image/bmp" },
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" },
]

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  pdf: "application/pdf",
}

function sniffMime(buf: Uint8Array): string | undefined {
  for (const { bytes, mime } of MAGIC) {
    if (bytes.every((b, i) => buf[i] === b)) return mime
  }
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    // biome-ignore lint/style/noNonNullAssertion: bounds checked by RIFF header match above
    const sub = String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!)
    if (sub === "WEBP") return "image/webp"
    if (sub === "AVI ") return "video/x-msvideo"
  }
  return undefined
}

function mimeFromExt(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? EXT_TO_MIME[ext] : undefined
}

// ---------------------------------------------------------------------------
// Image thumbnail via OffscreenCanvas (browser API, available in Tauri webview)
// ---------------------------------------------------------------------------

const THUMB_MAX_EDGE = 512

/**
 * Downscale an image buffer to fit within THUMB_MAX_EDGE px.
 * Returns JPEG base64 string (no data: prefix).
 */
async function createThumbnailBase64(buf: Uint8Array, mediaType: string): Promise<string> {
  const blob = new Blob([new Uint8Array(buf) as BlobPart], { type: mediaType })
  const bitmap = await createImageBitmap(blob)

  const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Failed to get 2d context")
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })
  const ab = await jpegBlob.arrayBuffer()
  const bytes = new Uint8Array(ab)

  // Convert to base64 in browser
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    // biome-ignore lint/style/noNonNullAssertion: index within bounds
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

// ---------------------------------------------------------------------------
// Resolve asset:// URL → absolute file path
// ---------------------------------------------------------------------------

function resolveAssetUrl(url: string): string | null {
  if (!url.startsWith("asset://")) return null
  const encoded = url.replace(/^asset:\/\/localhost\//, "").replace(/^asset:\/\/localhost/, "")
  return decodeURIComponent(encoded)
}

// ---------------------------------------------------------------------------
// Read raw media bytes from various sources
// ---------------------------------------------------------------------------

async function readMediaBytes(
  source: string
): Promise<{ buf: Uint8Array; pathHint: string } | { error: string }> {
  // Case 1: Node ID — resolve from canvas store
  const { nodes } = getStore()
  const node = nodes.find((n) => n.id === source)
  if (node) {
    const latest = node.data.historys[0]?.result
    if (!latest || latest.type === "text") {
      return { error: `Node "${source}" has no media content (type: ${latest?.type ?? "none"})` }
    }
    const absPath = resolveAssetUrl(latest.url)
    if (!absPath) {
      return { error: `Cannot resolve asset URL for node "${source}"` }
    }
    const buf = await readFile(absPath)
    return { buf, pathHint: absPath }
  }

  // Case 2: HTTP(S) URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) {
      return { error: `HTTP ${response.status} ${response.statusText}` }
    }
    const ab = await response.arrayBuffer()
    return { buf: new Uint8Array(ab), pathHint: source }
  }

  // Case 3: Local file path
  const buf = await readFile(source)
  return { buf, pathHint: source }
}

// ---------------------------------------------------------------------------
// Tool factory — needs settings for vision model access
// ---------------------------------------------------------------------------

export function createCanvasTools(settings: AppSettings) {
  return {
    canvas_get_state: tool({
      description:
        "Get an overview of the current canvas: list of nodes (id, type, title, position) and edges. For media nodes, shows dimensions and type but not content — use read_media to get a description.",
      inputSchema: z.object({}),
      execute: async () => {
        const { nodes, edges } = getStore()
        return {
          nodes: nodes.map((n) => {
            const latest = n.data.historys[0]
            return {
              id: n.id,
              type: n.type,
              title: n.data.uiInfo.title,
              position: n.position,
              historyCount: n.data.historys.length,
              latestResult: latest ? serializeResult(latest.result) : null,
            }
          }),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })),
        }
      },
    }),

    canvas_get_node: tool({
      description:
        "Get detailed information about a specific node, including all history entries. Media content (images) is described but not included — use read_media to get a text description.",
      inputSchema: z.object({
        nodeId: z.string().describe("The ID of the node to retrieve"),
      }),
      execute: async ({ nodeId }) => {
        const { nodes } = getStore()
        const node = nodes.find((n) => n.id === nodeId)
        if (!node) return { error: `Node "${nodeId}" not found` }
        return {
          id: node.id,
          type: node.type,
          position: node.position,
          title: node.data.uiInfo.title,
          historys: node.data.historys.map(serializeHistory),
        }
      },
    }),

    canvas_get_selected: tool({
      description: "Get the currently selected nodes on the canvas.",
      inputSchema: z.object({}),
      execute: async () => {
        const { nodes, selectedNodeIds } = getStore()
        if (selectedNodeIds.length === 0) return { selected: [] }
        const selected = nodes.filter((n) => selectedNodeIds.includes(n.id))
        return {
          selected: selected.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.data.uiInfo.title,
            position: n.position,
            latestHistory: n.data.historys[0] ? serializeHistory(n.data.historys[0]) : null,
          })),
        }
      },
    }),

    // -----------------------------------------------------------------------
    // File & media reading
    // -----------------------------------------------------------------------

    read_file: tool({
      description:
        "Read a local text file. Returns the file content as text. For large files, content is truncated to 50,000 characters. Use this for .txt, .md, .json, .csv, source code, etc.",
      inputSchema: z.object({
        path: z.string().describe("Absolute file path to read"),
      }),
      execute: async ({ path }) => {
        try {
          const content = await readTextFile(path)
          const truncated = content.length > 50_000
          return {
            path,
            content: truncated ? content.slice(0, 50_000) : content,
            truncated,
            byteSize: content.length,
          }
        } catch (err) {
          return { error: `Failed to read file: ${(err as Error).message}`, path }
        }
      },
    }),

    read_media: tool({
      description:
        "Analyze a media file (image) and return a text description of its content. Can read: (1) a canvas node by node ID, (2) a local file path, or (3) an HTTP(S) URL. Internally uses a vision model to describe the image — the result is always text, never raw image data.",
      inputSchema: z.object({
        source: z
          .string()
          .describe(
            "A node ID, file path, or HTTP(S) URL. When a node ID is given, reads the latest media from that node."
          ),
        question: z
          .string()
          .optional()
          .describe(
            'Optional question to ask about the image, e.g. "What text is in this image?" Defaults to a general description.'
          ),
      }),
      execute: async ({ source, question }) => {
        try {
          const result = await readMediaBytes(source)
          if ("error" in result) return { error: result.error, source }

          const { buf, pathHint } = result
          const mediaType = sniffMime(buf) ?? mimeFromExt(pathHint) ?? "application/octet-stream"

          // Only images can be analyzed by vision model
          if (!mediaType.startsWith("image/")) {
            return {
              source,
              mediaType,
              byteSize: buf.byteLength,
              description: `Non-image media file (${mediaType}, ${(buf.byteLength / 1024).toFixed(0)} KB). Cannot analyze content.`,
            }
          }

          // Size guard
          if (buf.byteLength > 20 * 1024 * 1024) {
            return {
              error: `File too large: ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB exceeds 20 MB limit`,
            }
          }

          // Create thumbnail (downscale to 512px max edge → JPEG)
          const thumbBase64 = await createThumbnailBase64(buf, mediaType)

          // Call vision model for description
          const provider = createSeed({
            apiKey: settings.apiKey,
            baseURL: settings.baseURL,
          })

          const prompt = question ?? "Describe this image in detail. What does it contain?"

          const visionResult = await generateText({
            model: provider.chat("doubao-seed-1-6-vision-250815"),
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  {
                    type: "file",
                    mediaType: "image/jpeg",
                    data: thumbBase64,
                  },
                ],
              },
            ],
          })

          return {
            source,
            mediaType,
            byteSize: buf.byteLength,
            description: visionResult.text,
          }
        } catch (err) {
          return { error: `Failed to analyze media: ${(err as Error).message}`, source }
        }
      },
    }),

    web_search: tool({
      description:
        "Search the web via Exa. Returns up to 5 results with title, URL, and description snippet.",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        limit: z.number().optional().describe("Max results (default 5, max 10)"),
      }),
      execute: async ({ query, limit }) => {
        try {
          const numResults = Math.min(limit ?? 5, 10)
          const body = JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "web_search_exa",
              arguments: { query, numResults },
            },
          })

          const response = await fetch("https://mcp.exa.ai/mcp", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body,
          })

          if (!response.ok) {
            return { error: `Search failed: ${response.status} ${response.statusText}` }
          }

          const text = await response.text()
          let parsed: { result?: { content: Array<{ text: string }> } } | null = null
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              parsed = JSON.parse(line.slice(6))
              break
            }
          }

          if (!parsed?.result?.content?.[0]?.text) {
            return { query, results: [] }
          }

          const raw = parsed.result.content[0].text
          const blocks = raw.split(/\n(?=Title: )/)
          const results: Array<{ title: string; url: string; description: string }> = []
          for (const block of blocks) {
            if (results.length >= numResults) break
            const titleMatch = /^Title: (.+)/m.exec(block)
            const urlMatch = /^URL: (.+)/m.exec(block)
            const textMatch = /^Text: ([\s\S]+)/m.exec(block)
            if (!titleMatch || !urlMatch) continue
            results.push({
              title: (titleMatch[1] ?? "").trim(),
              url: (urlMatch[1] ?? "").trim(),
              description: textMatch
                ? (textMatch[1] ?? "").replace(/\n/g, " ").trim().slice(0, 300)
                : "",
            })
          }

          return { query, results }
        } catch (err) {
          return { error: `Search failed: ${(err as Error).message}` }
        }
      },
    }),

    web_fetch: tool({
      description:
        "Fetch a URL and extract its main text content. Returns clean text (HTML tags stripped). Useful for reading web pages, articles, documentation. Max 20,000 characters.",
      inputSchema: z.object({
        url: z.string().describe("The URL to fetch"),
      }),
      execute: async ({ url }) => {
        try {
          const response = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; SeedCanvasBot/1.0)",
              Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(15_000),
          })

          if (!response.ok) {
            return { error: `HTTP ${response.status} ${response.statusText}`, url }
          }

          const contentType = response.headers.get("content-type") ?? ""
          const text = await response.text()

          if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
            const truncated = text.length > 20_000
            return {
              url,
              title: url,
              content: text.slice(0, 20_000),
              truncated,
            }
          }

          const parser = new DOMParser()
          const doc = parser.parseFromString(text, "text/html")

          for (const tag of ["script", "style", "noscript", "iframe", "svg", "nav", "footer"]) {
            for (const el of doc.querySelectorAll(tag)) el.remove()
          }

          const title = doc.title || url
          const main = doc.querySelector("article, main, [role=main]") ?? doc.body
          const content = main?.textContent?.replace(/\s+/g, " ").trim() ?? ""

          const truncated = content.length > 20_000
          return {
            url,
            title,
            content: content.slice(0, 20_000),
            truncated,
          }
        } catch (err) {
          return { error: `Fetch failed: ${(err as Error).message}`, url }
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Canvas mutation tools
    // -----------------------------------------------------------------------

    canvas_add_node: tool({
      description:
        'Create a new node on the canvas. Supported types: "text", "image", "video". For text nodes, provide initialContent. For image/video, provide a url. When deriving from an existing node, position the new node nearby and follow up with canvas_add_edge.',
      inputSchema: z.object({
        type: z.enum(["text", "image", "video"]).describe("Node type"),
        title: z.string().describe("Display title for the node"),
        position: z
          .object({ x: z.number(), y: z.number() })
          .optional()
          .describe(
            "Canvas position. When deriving from a source node, offset from its position. Defaults to viewport center if omitted."
          ),
        initialContent: z.string().optional().describe("Initial text content (for text nodes)"),
        url: z.string().optional().describe("URL for image or video nodes"),
        width: z.number().optional().describe("Width for image/video"),
        height: z.number().optional().describe("Height for image/video"),
      }),
      execute: async ({ type, title, position, initialContent, url, width, height }) => {
        const vp = getStore().viewport
        const pos = position ?? {
          x: Math.round(-vp.x / vp.zoom),
          y: Math.round(-vp.y / vp.zoom),
        }
        const historyEntry: HistoryEntry = {
          id: generateId(),
          parameters: {},
          result:
            type === "text"
              ? { type: "text", content: initialContent ?? "" }
              : type === "image"
                ? { type: "image", url: url ?? "", width: width ?? 300, height: height ?? 250 }
                : { type: "video", url: url ?? "", width: width ?? 400, height: height ?? 300 },
          createdAt: new Date().toISOString(),
        }

        const node: CanvasNode = {
          id: generateId(),
          type,
          position: pos,
          data: {
            uiInfo: { title },
            historys: [historyEntry],
          },
        }

        getStore().addNode(node)
        return { created: node.id, type, title, position: pos }
      },
    }),

    canvas_update_node: tool({
      description:
        "Update an existing node's title or push a new history entry with text/image/video content.",
      inputSchema: z.object({
        nodeId: z.string().describe("The ID of the node to update"),
        title: z.string().optional().describe("New title for the node"),
        newContent: z.string().optional().describe("New text content to push as history entry"),
        newImageUrl: z.string().optional().describe("New image URL to push as history entry"),
        newVideoUrl: z.string().optional().describe("New video URL to push as history entry"),
      }),
      execute: async ({ nodeId, title, newContent, newImageUrl, newVideoUrl }) => {
        const store = getStore()
        const node = store.nodes.find((n) => n.id === nodeId)
        if (!node) return { error: `Node "${nodeId}" not found` }

        if (title) {
          store.updateNodeData(nodeId, { uiInfo: { title } })
        }

        if (newContent) {
          store.pushHistory(nodeId, {
            id: generateId(),
            parameters: {},
            result: { type: "text", content: newContent },
            createdAt: new Date().toISOString(),
          })
        } else if (newImageUrl) {
          store.pushHistory(nodeId, {
            id: generateId(),
            parameters: {},
            result: { type: "image", url: newImageUrl, width: 300, height: 250 },
            createdAt: new Date().toISOString(),
          })
        } else if (newVideoUrl) {
          store.pushHistory(nodeId, {
            id: generateId(),
            parameters: {},
            result: { type: "video", url: newVideoUrl, width: 400, height: 300 },
            createdAt: new Date().toISOString(),
          })
        }

        return { updated: nodeId }
      },
    }),

    canvas_delete_node: tool({
      description: "Delete one or more nodes from the canvas. Connected edges are also removed.",
      inputSchema: z.object({
        nodeIds: z.array(z.string()).describe("IDs of nodes to delete"),
      }),
      execute: async ({ nodeIds }) => {
        getStore().deleteNodes(nodeIds)
        return { deleted: nodeIds }
      },
    }),

    canvas_add_edge: tool({
      description:
        "Create an edge (connection) between two nodes. Use this whenever a new node is derived from an existing one (e.g. analysis result, summary, translation) to record the source → output relationship.",
      inputSchema: z.object({
        source: z.string().describe("Source node ID (the origin of the content)"),
        target: z.string().describe("Target node ID (the derived/new node)"),
      }),
      execute: async ({ source, target }) => {
        const edge: CanvasEdge = {
          id: `e-${source}-${target}`,
          source,
          target,
        }
        const store = getStore()
        useCanvasStore.setState({
          edges: [...store.edges, edge],
          isDirty: true,
        })
        return { created: edge.id, source, target }
      },
    }),

    canvas_delete_edge: tool({
      description: "Delete one or more edges from the canvas.",
      inputSchema: z.object({
        edgeIds: z.array(z.string()).describe("IDs of edges to delete"),
      }),
      execute: async ({ edgeIds }) => {
        getStore().deleteEdges(edgeIds)
        return { deleted: edgeIds }
      },
    }),
  }
}
