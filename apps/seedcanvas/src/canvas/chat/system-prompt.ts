import type { CanvasEdge, CanvasNode, CanvasViewport } from "@/canvas/types"

const BASE_PROMPT = `You are a canvas assistant for SeedCanvas, a visual node-based editor where users organize content as nodes connected by edges.

<context>
Nodes hold content (text, image, video) with version history. Edges represent relationships — when node B is derived from node A (analysis, summary, translation, etc.), an edge A → B records that provenance. Users rely on edges to trace how content flows across the canvas.
</context>

<tool-strategy>
Observe before acting — use canvas_get_selected or canvas_get_state to understand current context before making changes.

To see what's inside an image node, call read_media with its node ID. canvas_get_node only returns dimensions, not visual content.

When you produce a new node from an existing one, always:
1. Create the new node (canvas_add_node) positioned near the source node.
2. Connect source → new node (canvas_add_edge).

When the user says "this node" or "selected", resolve via canvas_get_selected first.
</tool-strategy>

<constraints>
- Be concise — the user sees canvas changes directly, no need to repeat content in chat.
- Preserve existing edges when modifying nodes.
</constraints>`

export interface CanvasContext {
  viewport: CanvasViewport
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedNodeIds: string[]
}

function summarizeNode(n: CanvasNode): string {
  const latest = n.data.historys[0]
  const latestContent =
    latest?.result.type === "text"
      ? latest.result.content.slice(0, 200)
      : latest?.result.type
        ? `[${latest.result.type}]`
        : "(empty)"
  return `- ${n.id} (${n.type ?? "default"}) at (${Math.round(n.position.x)}, ${Math.round(n.position.y)}): "${n.data.uiInfo.title}" → ${latestContent}`
}

export function buildSystemPrompt(ctx: CanvasContext): string {
  const sections: string[] = [BASE_PROMPT]

  // Viewport — helps agent position new nodes
  const vp = ctx.viewport
  const cx = Math.round(-vp.x / vp.zoom)
  const cy = Math.round(-vp.y / vp.zoom)
  sections.push(`<viewport center="(${cx}, ${cy})" zoom="${vp.zoom.toFixed(2)}" />`)

  // Canvas snapshot
  if (ctx.nodes.length > 0) {
    const nodeLines = ctx.nodes.map(summarizeNode).join("\n")
    const header = `<canvas-state nodes="${ctx.nodes.length}" edges="${ctx.edges.length}">`
    sections.push(`${header}\n${nodeLines}`)

    if (ctx.edges.length > 0) {
      const edgeLines = ctx.edges
        .map((e) => {
          const src = ctx.nodes.find((n) => n.id === e.source)
          const tgt = ctx.nodes.find((n) => n.id === e.target)
          const srcLabel = src ? `"${src.data.uiInfo.title}"` : e.source
          const tgtLabel = tgt ? `"${tgt.data.uiInfo.title}"` : e.target
          return `  ${srcLabel} → ${tgtLabel}`
        })
        .join("\n")
      sections.push(`Edges:\n${edgeLines}`)
    }

    sections.push("</canvas-state>")
  } else {
    sections.push("<canvas-state>Empty canvas.</canvas-state>")
  }

  // Selected nodes
  const selectedNodes = ctx.nodes.filter((n) => ctx.selectedNodeIds.includes(n.id))
  if (selectedNodes.length > 0) {
    const selectedLines = selectedNodes.map(summarizeNode).join("\n")
    sections.push(`<selected>\n${selectedLines}\n</selected>`)
  }

  return sections.join("\n\n")
}
