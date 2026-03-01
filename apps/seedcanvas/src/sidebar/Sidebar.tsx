export function Sidebar() {
  return (
    <aside className="w-72 border-r border-zinc-200 bg-zinc-50 flex flex-col">
      <div className="p-4 border-b border-zinc-200">
        <h2 className="text-sm font-semibold text-zinc-700">SeedCanvas</h2>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-zinc-400 text-center">
          AI Chat coming in Phase 3
        </p>
      </div>
    </aside>
  )
}
