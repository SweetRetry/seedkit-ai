import './App.css'
import { Canvas } from './canvas/Canvas'
import { Sidebar } from './sidebar/Sidebar'

export default function App() {
  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <Canvas />
    </div>
  )
}
