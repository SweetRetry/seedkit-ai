import { describe, expect, it } from "vitest"
import { type BatchOp, executeBatch } from "./batch-ops"
import type { CanvasEdge, CanvasNode, CanvasViewport } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const viewport: CanvasViewport = { x: 0, y: 0, zoom: 1 }

function makeNode(id: string, type = "text", title = "Test"): CanvasNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {
      uiInfo: { title },
      historys: [
        {
          id: "h1",
          parameters: {},
          result: { type: "text", content: "initial" },
          createdAt: "2026-01-01T00:00:00Z",
        },
      ],
    },
  }
}

function makeEdge(source: string, target: string): CanvasEdge {
  return { id: `e-${source}-${target}`, source, target }
}

function empty() {
  return { nodes: [] as CanvasNode[], edges: [] as CanvasEdge[], viewport }
}

// ---------------------------------------------------------------------------
// add_node
// ---------------------------------------------------------------------------

describe("add_node", () => {
  it("creates a text node with initial content", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "Note", initialContent: "hello" },
    ]
    const { nodes, results } = executeBatch(ops, empty())

    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe("text")
    expect(nodes[0].data.uiInfo.title).toBe("Note")
    expect(nodes[0].data.historys[0].result).toEqual({ type: "text", content: "hello" })
    expect(results[0]).toMatchObject({ op: "add_node", title: "Note" })
  })

  it("creates an image node with url and dimensions", () => {
    const ops: BatchOp[] = [
      {
        op: "add_node",
        type: "image",
        title: "Cat",
        url: "/path/to/cat.png",
        width: 400,
        height: 300,
      },
    ]
    const { nodes } = executeBatch(ops, empty())

    expect(nodes[0].type).toBe("image")
    const result = nodes[0].data.historys[0].result
    expect(result).toEqual({ type: "image", url: "/path/to/cat.png", width: 400, height: 300 })
  })

  it("creates a video node with defaults when dimensions omitted", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "video", title: "Clip" },
    ]
    const { nodes } = executeBatch(ops, empty())

    const result = nodes[0].data.historys[0].result
    expect(result).toEqual({ type: "video", url: "", width: 400, height: 300 })
  })

  it("uses explicit position when provided", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "A", position: { x: 100, y: 200 } },
    ]
    const { nodes } = executeBatch(ops, empty())
    expect(nodes[0].position).toEqual({ x: 100, y: 200 })
  })

  it("falls back to viewport center when position omitted", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "A" },
    ]
    const vp: CanvasViewport = { x: -500, y: -300, zoom: 2 }
    const { nodes } = executeBatch(ops, { nodes: [], edges: [], viewport: vp })
    expect(nodes[0].position).toEqual({ x: 250, y: 150 })
  })

  it("registers ref and returns it in result", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "A", ref: "myNode" },
    ]
    const { results } = executeBatch(ops, empty())
    expect(results[0]).toMatchObject({ op: "add_node", ref: "myNode" })
    expect(results[0].id).toBeDefined()
  })

  it("sets node.style for media nodes based on aspect ratio", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "image", title: "Wide", url: "/wide.png", width: 2848, height: 1600 },
    ]
    const { nodes } = executeBatch(ops, empty())
    // Landscape: height=400, width=400*(2848/1600)=712
    expect(nodes[0].style).toMatchObject({ width: 712, height: 400 })
  })

  it("sets square style for square media", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "image", title: "Square", url: "/sq.png", width: 2048, height: 2048 },
    ]
    const { nodes } = executeBatch(ops, empty())
    expect(nodes[0].style).toMatchObject({ width: 400, height: 400 })
  })

  it("sets portrait style for tall media", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "image", title: "Tall", url: "/tall.png", width: 1600, height: 2848 },
    ]
    const { nodes } = executeBatch(ops, empty())
    // Portrait: width=400, height=400/(1600/2848)=712
    expect(nodes[0].style).toMatchObject({ width: 400, height: 712 })
  })

  it("sets fixed width style for text nodes", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "Note", initialContent: "hello" },
    ]
    const { nodes } = executeBatch(ops, empty())
    expect(nodes[0].style).toMatchObject({ width: 400 })
    expect((nodes[0].style as Record<string, unknown>).height).toBeUndefined()
  })

  it("does not mutate the input arrays", () => {
    const original = empty()
    const nodesBefore = original.nodes
    executeBatch([{ op: "add_node", type: "text", title: "A" }], original)
    expect(original.nodes).toBe(nodesBefore)
    expect(original.nodes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// update_node
// ---------------------------------------------------------------------------

describe("update_node", () => {
  it("updates node title", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "n1", title: "New Title" }]
    const { nodes } = executeBatch(ops, input)
    expect(nodes[0].data.uiInfo.title).toBe("New Title")
  })

  it("pushes new text content as history entry", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "n1", newContent: "updated" }]
    const { nodes } = executeBatch(ops, input)
    // New entry is prepended
    expect(nodes[0].data.historys[0].result).toEqual({ type: "text", content: "updated" })
    expect(nodes[0].data.historys).toHaveLength(2)
  })

  it("pushes image URL as history entry", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "n1", newImageUrl: "/img.png" }]
    const { nodes } = executeBatch(ops, input)
    expect(nodes[0].data.historys[0].result).toEqual({
      type: "image",
      url: "/img.png",
      width: 300,
      height: 250,
    })
  })

  it("pushes video URL as history entry", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "n1", newVideoUrl: "/vid.mp4" }]
    const { nodes } = executeBatch(ops, input)
    expect(nodes[0].data.historys[0].result).toEqual({
      type: "video",
      url: "/vid.mp4",
      width: 400,
      height: 300,
    })
  })

  it("updates node position", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "n1", position: { x: 500, y: 600 } }]
    const { nodes } = executeBatch(ops, input)
    expect(nodes[0].position).toEqual({ x: 500, y: 600 })
  })

  it("sets node.style when pushing image with dimensions", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [
      { op: "update_node", nodeId: "n1", newImageUrl: "/img.png", width: 2048, height: 2048 },
    ]
    const { nodes } = executeBatch(ops, input)
    // Square 2048x2048 → display 400x400 (short side = 400)
    expect(nodes[0].style).toMatchObject({ width: 400, height: 400 })
  })

  it("sets node.style preserving aspect ratio for landscape image", () => {
    const input = { nodes: [makeNode("n1")], edges: [], viewport }
    const ops: BatchOp[] = [
      { op: "update_node", nodeId: "n1", newImageUrl: "/wide.png", width: 2848, height: 1600 },
    ]
    const { nodes } = executeBatch(ops, input)
    // Landscape → height=400, width=400*(2848/1600)=712
    expect(nodes[0].style).toMatchObject({ width: 712, height: 400 })
  })

  it("reports error for missing node", () => {
    const ops: BatchOp[] = [{ op: "update_node", nodeId: "nonexistent" }]
    const { results } = executeBatch(ops, empty())
    expect(results[0]).toMatchObject({ op: "update_node", error: expect.stringContaining("not found") })
  })
})

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  it("deletes nodes by id", () => {
    const input = {
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [makeEdge("n1", "n2")],
      viewport,
    }
    const ops: BatchOp[] = [{ op: "delete", nodeIds: ["n1"] }]
    const { nodes, edges } = executeBatch(ops, input)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].id).toBe("n2")
    // Edge connected to deleted node is also removed
    expect(edges).toHaveLength(0)
  })

  it("deletes edges by id", () => {
    const input = {
      nodes: [makeNode("n1"), makeNode("n2")],
      edges: [makeEdge("n1", "n2")],
      viewport,
    }
    const ops: BatchOp[] = [{ op: "delete", edgeIds: ["e-n1-n2"] }]
    const { nodes, edges } = executeBatch(ops, input)
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(0)
  })

  it("reports error when both nodeIds and edgeIds empty", () => {
    const ops: BatchOp[] = [{ op: "delete" }]
    const { results } = executeBatch(ops, empty())
    expect(results[0]).toMatchObject({ op: "delete", error: expect.any(String) })
  })
})

// ---------------------------------------------------------------------------
// add_edge
// ---------------------------------------------------------------------------

describe("add_edge", () => {
  it("connects two nodes", () => {
    const input = { nodes: [makeNode("n1"), makeNode("n2")], edges: [], viewport }
    const ops: BatchOp[] = [{ op: "add_edge", source: "n1", target: "n2" }]
    const { edges, results } = executeBatch(ops, input)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ source: "n1", target: "n2" })
    expect(results[0]).toMatchObject({ op: "add_edge", source: "n1", target: "n2" })
  })

  it("resolves ref names from earlier add_node ops", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "A", ref: "nodeA" },
      { op: "add_node", type: "text", title: "B", ref: "nodeB" },
      { op: "add_edge", source: "nodeA", target: "nodeB" },
    ]
    const { edges, nodes } = executeBatch(ops, empty())
    expect(edges).toHaveLength(1)
    expect(edges[0].source).toBe(nodes[0].id)
    expect(edges[0].target).toBe(nodes[1].id)
  })
})

// ---------------------------------------------------------------------------
// mixed batch (integration)
// ---------------------------------------------------------------------------

describe("mixed batch", () => {
  it("executes multiple operations in order", () => {
    const ops: BatchOp[] = [
      { op: "add_node", type: "image", title: "Img", url: "/cat.png", width: 400, height: 400, ref: "img" },
      { op: "add_node", type: "text", title: "Caption", initialContent: "A cute cat", ref: "txt" },
      { op: "add_edge", source: "img", target: "txt" },
    ]
    const { nodes, edges, results } = executeBatch(ops, empty())

    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(results).toHaveLength(3)

    // Edge resolves refs to real IDs
    expect(edges[0].source).toBe(nodes[0].id)
    expect(edges[0].target).toBe(nodes[1].id)
  })

  it("preserves existing nodes/edges while adding new ones", () => {
    const existing = {
      nodes: [makeNode("pre1")],
      edges: [makeEdge("pre1", "pre1")],
      viewport,
    }
    const ops: BatchOp[] = [
      { op: "add_node", type: "text", title: "New" },
    ]
    const { nodes, edges } = executeBatch(ops, existing)
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
    expect(nodes[0].id).toBe("pre1")
  })
})
