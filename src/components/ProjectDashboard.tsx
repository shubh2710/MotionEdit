import React, { useEffect, useState, useRef } from 'react';
import { useEditorStore } from '../store/editorStore';
import { ProjectMeta } from '../utils/projectTypes';
import {
  listProjects, deleteProject, removeFromRecent,
  duplicateProject, importProjectFromFile, exportProjectToFile,
} from '../utils/projectStorage';
import { generateId } from '../utils/helpers';
import { APP_VERSION, APP_NAME, CHANGELOG } from '../version';

export const ProjectDashboard: React.FC = () => {
  const [showChangelog, setShowChangelog] = useState(false);
  const { newProject, loadProjectById } = useEditorStore();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    const list = await listProjects();
    setProjects(list);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const handleNew = () => {
    newProject();
  };

  const handleOpen = async (id: string) => {
    await loadProjectById(id);
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    removeFromRecent(id);
    setConfirmDeleteId(null);
    refresh();
  };

  const handleDuplicate = async (project: ProjectMeta) => {
    const newId = generateId();
    await duplicateProject(project.projectId, `${project.projectName} (Copy)`, newId);
    refresh();
  };

  const handleExport = async (id: string) => {
    const blob = await exportProjectToFile(id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project_${id.slice(0, 8)}.vedproj`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    const data = await importProjectFromFile(file);
    setImporting(false);
    if (data) {
      await refresh();
      await loadProjectById(data.projectId);
    }
    e.target.value = '';
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString();
    } catch {
      return 'Unknown';
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <div className="flex-1 flex items-start justify-center overflow-y-auto py-12 px-6">
        <div className="w-full max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <svg className="w-8 h-8 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" />
                </svg>
                <h1 className="text-2xl font-bold">{APP_NAME}</h1>
              </div>
              <p className="text-gray-500 text-sm">Create, edit, and export professional videos</p>
            </div>
            <button
              onClick={() => setShowChangelog(!showChangelog)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/60 border border-gray-700/50 hover:border-gray-600 transition-colors text-xs text-gray-400 hover:text-gray-200"
            >
              <span className="w-2 h-2 rounded-full bg-green-500" />
              v{APP_VERSION}
            </button>
          </div>

          {/* Changelog */}
          {showChangelog && (
            <div className="mb-6 p-4 bg-gray-900 rounded-xl border border-gray-800 animate-in fade-in">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-300">Changelog</h3>
                <button onClick={() => setShowChangelog(false)} className="text-gray-500 hover:text-gray-300 text-xs">Close</button>
              </div>
              <div className="space-y-4 max-h-60 overflow-y-auto pr-2">
                {CHANGELOG.map((entry) => (
                  <div key={entry.version}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-mono font-bold text-blue-400">v{entry.version}</span>
                      <span className="text-[10px] text-gray-600">{entry.date}</span>
                    </div>
                    <ul className="space-y-0.5">
                      {entry.changes.map((change, i) => (
                        <li key={i} className="text-xs text-gray-400 flex items-start gap-2">
                          <span className="text-gray-600 mt-0.5">-</span>
                          <span>{change}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <button
              onClick={handleNew}
              className="group flex flex-col items-center justify-center gap-3 p-6 bg-gray-900 rounded-xl border border-gray-800 hover:border-blue-500/50 hover:bg-gray-800/80 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center group-hover:bg-blue-600/30 transition-colors">
                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-medium">New Project</span>
            </button>

            <button
              onClick={() => importRef.current?.click()}
              disabled={importing}
              className="group flex flex-col items-center justify-center gap-3 p-6 bg-gray-900 rounded-xl border border-gray-800 hover:border-green-500/50 hover:bg-gray-800/80 transition-all disabled:opacity-50"
            >
              <div className="w-12 h-12 rounded-full bg-green-600/20 flex items-center justify-center group-hover:bg-green-600/30 transition-colors">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <span className="text-sm font-medium">{importing ? 'Importing...' : 'Import Project'}</span>
            </button>

            <input ref={importRef} type="file" accept=".vedproj,.json" className="hidden" onChange={handleImport} />

            <div className="flex flex-col items-center justify-center gap-3 p-6 bg-gray-900 rounded-xl border border-gray-800">
              <div className="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-500">{projects.length} Project{projects.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Projects list */}
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-4">Recent Projects</h2>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <svg className="w-6 h-6 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-16 text-gray-600">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-2 2v14a2 2 0 01-2 2H9a2 2 0 01-2-2V6h6z" />
                </svg>
                <p className="text-lg mb-1">No projects yet</p>
                <p className="text-sm">Click "New Project" to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.projectId}
                    className="group flex items-center gap-4 p-4 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 hover:bg-gray-800/80 transition-all cursor-pointer"
                    onClick={() => handleOpen(project.projectId)}
                  >
                    {/* Thumbnail */}
                    <div className="w-20 h-12 rounded-lg bg-gray-800 border border-gray-700 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      {project.thumbnail ? (
                        <img src={project.thumbnail} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold truncate">{project.projectName}</h3>
                      <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                        <span>{formatDate(project.updatedAt)}</span>
                        <span>{project.clipCount} clip{project.clipCount !== 1 ? 's' : ''}</span>
                        <span>{formatDuration(project.duration)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                      <ActionButton
                        title="Duplicate"
                        onClick={() => handleDuplicate(project)}
                        icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>}
                      />
                      <ActionButton
                        title="Export project file"
                        onClick={() => handleExport(project.projectId)}
                        icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                      />
                      {confirmDeleteId === project.projectId ? (
                        <button
                          onClick={() => handleDelete(project.projectId)}
                          className="px-2 py-1 text-[10px] bg-red-600 text-white rounded font-medium hover:bg-red-500 transition-colors"
                        >
                          Confirm
                        </button>
                      ) : (
                        <ActionButton
                          title="Delete"
                          onClick={() => setConfirmDeleteId(project.projectId)}
                          danger
                          icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-4 px-6 py-3 border-t border-gray-800/50 text-[11px] text-gray-600">
        <span>{APP_NAME} v{APP_VERSION}</span>
        <span className="text-gray-800">|</span>
        <span>Built with React + FFmpeg</span>
      </div>
    </div>
  );
};

const ActionButton: React.FC<{
  title: string;
  onClick: () => void;
  icon: React.ReactNode;
  danger?: boolean;
}> = ({ title, onClick, icon, danger }) => (
  <button
    title={title}
    onClick={onClick}
    className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors
      ${danger
        ? 'text-gray-500 hover:text-red-400 hover:bg-red-900/30'
        : 'text-gray-500 hover:text-white hover:bg-gray-700'}`}
  >
    {icon}
  </button>
);
