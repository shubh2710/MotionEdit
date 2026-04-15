import {
  ProjectData, ProjectMeta, ProjectAsset,
  PROJECT_DB_NAME, PROJECT_DB_VERSION,
  STORE_PROJECTS, STORE_ASSETS, STORE_META,
} from './projectTypes';

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS);
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}

function tx(
  stores: string | string[],
  mode: IDBTransactionMode,
): Promise<IDBTransaction> {
  return openDB().then((db) => db.transaction(stores, mode));
}

function idbPut<T>(storeName: string, value: T): Promise<void> {
  return tx(storeName, 'readwrite').then(
    (t) =>
      new Promise((resolve, reject) => {
        t.objectStore(storeName).put(value);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return tx(storeName, 'readonly').then(
    (t) =>
      new Promise((resolve, reject) => {
        const req = t.objectStore(storeName).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbGetAll<T>(storeName: string): Promise<T[]> {
  return tx(storeName, 'readonly').then(
    (t) =>
      new Promise((resolve, reject) => {
        const req = t.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result as T[]);
        req.onerror = () => reject(req.error);
      }),
  );
}

function idbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  return tx(storeName, 'readwrite').then(
    (t) =>
      new Promise((resolve, reject) => {
        t.objectStore(storeName).delete(key);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
      }),
  );
}

// ---- Asset blob storage (keyed by "projectId/assetId") ----

function assetKey(projectId: string, assetId: string): string {
  return `${projectId}/${assetId}`;
}

export async function saveAssetBlob(
  projectId: string,
  assetId: string,
  blob: Blob,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_ASSETS, 'readwrite');
    t.objectStore(STORE_ASSETS).put(blob, assetKey(projectId, assetId));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadAssetBlob(
  projectId: string,
  assetId: string,
): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_ASSETS, 'readonly');
    const req = t.objectStore(STORE_ASSETS).get(assetKey(projectId, assetId));
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function deleteProjectAssets(projectId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_ASSETS, 'readwrite');
    const store = t.objectStore(STORE_ASSETS);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(projectId + '/')) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---- Project CRUD ----

export async function saveProject(data: ProjectData): Promise<void> {
  const meta: ProjectMeta = {
    projectId: data.projectId,
    projectName: data.projectName,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    clipCount: data.clips.length,
    duration: computeProjectDuration(data),
    version: data.version,
  };

  await idbPut(STORE_PROJECTS, data);
  await idbPut(STORE_META, meta);
}

export async function loadProject(projectId: string): Promise<ProjectData | undefined> {
  return idbGet<ProjectData>(STORE_PROJECTS, projectId);
}

export async function deleteProject(projectId: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, projectId);
  await idbDelete(STORE_META, projectId);
  await deleteProjectAssets(projectId);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await idbGetAll<ProjectMeta>(STORE_META);
  return all
    .filter((m) => m.projectName !== '__autosave__')
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function projectExists(projectId: string): Promise<boolean> {
  const meta = await idbGet<ProjectMeta>(STORE_META, projectId);
  return !!meta;
}

export async function duplicateProject(
  sourceId: string,
  newName: string,
  newId: string,
): Promise<ProjectData | undefined> {
  const source = await loadProject(sourceId);
  if (!source) return undefined;

  const now = new Date().toISOString();
  const dup: ProjectData = {
    ...source,
    projectId: newId,
    projectName: newName,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  // Copy asset blobs
  for (const asset of source.assets) {
    const blob = await loadAssetBlob(sourceId, asset.id);
    if (blob) await saveAssetBlob(newId, asset.id, blob);
  }

  await saveProject(dup);
  return dup;
}

// ---- Export / Import as file ----

export async function exportProjectToFile(projectId: string): Promise<Blob | null> {
  const data = await loadProject(projectId);
  if (!data) return null;

  const bundle: { project: ProjectData; assets: Record<string, string> } = {
    project: data,
    assets: {},
  };

  for (const asset of data.assets) {
    const blob = await loadAssetBlob(projectId, asset.id);
    if (blob) {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      bundle.assets[asset.id] = base64;
    }
  }

  const json = JSON.stringify(bundle);
  return new Blob([json], { type: 'application/json' });
}

export async function importProjectFromFile(file: File): Promise<ProjectData | null> {
  try {
    const text = await file.text();
    const bundle = JSON.parse(text) as {
      project: ProjectData;
      assets: Record<string, string>;
    };

    const data = bundle.project;
    data.updatedAt = new Date().toISOString();

    await saveProject(data);

    for (const [assetId, dataUrl] of Object.entries(bundle.assets)) {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      await saveAssetBlob(data.projectId, assetId, blob);
    }

    return data;
  } catch (err) {
    console.error('[Project] Import failed:', err);
    return null;
  }
}

// ---- Thumbnail generation ----

export async function updateProjectThumbnail(
  projectId: string,
  thumbnailDataUrl: string,
): Promise<void> {
  const meta = await idbGet<ProjectMeta>(STORE_META, projectId);
  if (meta) {
    meta.thumbnail = thumbnailDataUrl;
    await idbPut(STORE_META, meta);
  }
}

// ---- Helpers ----

function computeProjectDuration(data: ProjectData): number {
  let maxEnd = 0;
  for (const c of data.clips) {
    maxEnd = Math.max(maxEnd, c.offset + (c.end - c.start) / c.speed);
  }
  for (const t of data.textOverlays) maxEnd = Math.max(maxEnd, t.endTime);
  for (const i of data.imageOverlays) maxEnd = Math.max(maxEnd, i.endTime);
  return maxEnd;
}

export function getUsedAssetIds(data: Pick<ProjectData, 'clips' | 'imageOverlays'>): Set<string> {
  const ids = new Set<string>();
  for (const c of data.clips) {
    if (c.sourceId && c.type !== 'blank') ids.add(c.sourceId);
  }
  for (const io of data.imageOverlays) {
    ids.add(io.id);
  }
  return ids;
}

// ---- Recent projects in localStorage ----

const RECENT_KEY = 'recentProjects';
const MAX_RECENT = 10;

export function getRecentProjectIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function pushRecentProject(projectId: string): void {
  const list = getRecentProjectIds().filter((id) => id !== projectId);
  list.unshift(projectId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

export function removeFromRecent(projectId: string): void {
  const list = getRecentProjectIds().filter((id) => id !== projectId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}
