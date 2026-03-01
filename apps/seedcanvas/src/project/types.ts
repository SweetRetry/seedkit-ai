export interface ProjectManifest {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  version: number
  schemaVersion: "1.0"
}

export interface RecentProject {
  id: string
  name: string
  updatedAt: string
  path: string
  coverPath?: string
}
