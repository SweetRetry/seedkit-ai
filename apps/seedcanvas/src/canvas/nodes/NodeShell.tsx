import { Handle, NodeResizer, Position } from "@xyflow/react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const MIN_WIDTH = 250
const MIN_HEIGHT = 250

const handleClass = cn(
  "!w-2 !h-2 !rounded-full !border-0",
  "!bg-muted-foreground/40",
  "hover:!bg-primary hover:!w-3 hover:!h-3",
  "!transition-all !duration-150"
)

interface NodeShellProps {
  selected?: boolean
  label?: string
  children: ReactNode
  className?: string
}

export function NodeShell({ selected, label, children, className }: NodeShellProps) {
  return (
    <div
      className={cn(
        "group h-full w-full",
        "rounded-xl border bg-card text-card-foreground flex flex-col",
        "shadow-md shadow-black/10",
        "transition-shadow duration-200",
        selected ? "ring-2 ring-primary/80 shadow-lg shadow-primary/5" : "hover:shadow-lg",
        className
      )}
    >
      <NodeResizer
        isVisible={!!selected}
        minWidth={MIN_WIDTH}
        minHeight={MIN_HEIGHT}
        lineClassName="!border-transparent"
        handleClassName={cn(
          "!w-2 !h-2 !rounded-full !border-0",
          "!bg-primary/70 hover:!bg-primary hover:!w-3 hover:!h-3",
          "!transition-all !duration-150"
        )}
      />
      <Handle type="target" position={Position.Left} className={handleClass} />
      {label && (
        <div className="px-3 pt-2.5 pb-1">
          <span className="text-[11px] font-medium tracking-wide uppercase text-muted-foreground/70">
            {label}
          </span>
        </div>
      )}
      <div className="flex-1 overflow-hidden">{children}</div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  )
}
