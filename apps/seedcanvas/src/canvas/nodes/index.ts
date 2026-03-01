import type { NodeTypes } from "@xyflow/react"
import { ImageNode } from "./ImageNode"
import { TextNode } from "./TextNode"
import { VideoNode } from "./VideoNode"

// Defined at module level to avoid re-creating the object on each render.
export const nodeTypes: NodeTypes = {
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
}
