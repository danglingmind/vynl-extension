import React, { useState } from 'react'
import { useStore } from '../store'
import type { Project, WebsiteFile, Workspace } from '../api/vynl'

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  EDITOR: 'Editor',
  VIEWER: 'Viewer'
}

export function ProjectPicker() {
  const workspaces = useStore((s) => s.workspaces)
  const projectsStatus = useStore((s) => s.projectsStatus)
  const projectsError = useStore((s) => s.projectsError)

  if (projectsStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner />
      </div>
    )
  }

  if (projectsStatus === 'error') {
    return (
      <div className="flex items-center justify-center h-full px-6 text-center">
        <p className="text-xs text-red-500">{projectsError ?? 'Failed to load projects.'}</p>
      </div>
    )
  }

  if (!workspaces.length) {
    return (
      <div className="flex items-center justify-center h-full px-6 text-center">
        <p className="text-xs text-gray-400">No workspaces found.</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
      {workspaces.map((ws) => (
        <WorkspaceSection key={ws.id} workspace={ws} />
      ))}
    </div>
  )
}

function WorkspaceSection({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-gray-700 truncate">{workspace.name}</span>
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
            {ROLE_LABELS[workspace.role] ?? workspace.role}
          </span>
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="pb-1">
          {workspace.projects.length === 0 ? (
            <p className="px-6 py-2 text-xs text-gray-400">No projects</p>
          ) : (
            workspace.projects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project }: { project: Project }) {
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const selectedParentFileId = useStore((s) => s.selectedParentFileId)
  const selectProject = useStore((s) => s.selectProject)
  const selectParentFile = useStore((s) => s.selectParentFile)

  const isSelected = selectedProjectId === project.id
  const fileCount = project.websiteFiles.length

  return (
    <div>
      <button
        onClick={() => selectProject(isSelected ? null : project.id)}
        className={`w-full flex items-center justify-between px-4 py-2 text-left transition-colors ${
          isSelected ? 'bg-vynl-50' : 'hover:bg-gray-50'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <FolderIcon selected={isSelected} />
          <span className="text-xs text-gray-800 truncate">{project.name}</span>
        </div>
        <span className="shrink-0 text-[10px] text-gray-400 ml-2">
          {fileCount === 0 ? 'No pages' : `${fileCount} page${fileCount !== 1 ? 's' : ''}`}
        </span>
      </button>

      {isSelected && (
        <div className="ml-6 border-l border-gray-100">
          {/* New file option */}
          <button
            onClick={() => selectParentFile(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
              selectedParentFileId === null
                ? 'bg-vynl-50 text-vynl-700'
                : 'hover:bg-gray-50 text-gray-600'
            }`}
          >
            <PlusIcon />
            <span className="text-xs font-medium">New file in this project</span>
          </button>

          {/* Existing website files */}
          {project.websiteFiles.map((file) => (
            <ExistingFileRow
              key={file.id}
              file={file}
              selected={selectedParentFileId === file.id}
              onSelect={() => selectParentFile(file.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExistingFileRow({
  file,
  selected,
  onSelect
}: {
  file: WebsiteFile
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
        selected ? 'bg-vynl-50 text-vynl-700' : 'hover:bg-gray-50 text-gray-600'
      }`}
    >
      <RevisionIcon />
      <div className="min-w-0 flex-1">
        <p className="text-xs truncate">{file.fileName}</p>
        {file.metadata.originalUrl && (
          <p className="text-[10px] text-gray-400 truncate">{file.metadata.originalUrl}</p>
        )}
      </div>
      {selected && <span className="shrink-0 text-[10px] font-medium text-vynl-600">Revision</span>}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Small icons
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function FolderIcon({ selected }: { selected: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-vynl-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-vynl-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  )
}

function RevisionIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  )
}
