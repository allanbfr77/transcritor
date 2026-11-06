import type { Segment, Transcript } from "./types";

const DB_NAME = "transcritor";
const DB_VERSION = 1;

export interface JobProgressRecord {
  key: string;
  total: number;
  /** segmentos de cada janela já transcrita, por índice */
  windows: Record<number, Segment[]>;
  updatedAt: number;
  fileName: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("transcripts")) db.createObjectStore("transcripts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function listTranscripts(): Promise<Transcript[]> {
  try {
    const all = await tx<Transcript[]>("transcripts", "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function saveTranscript(t: Transcript): Promise<void> {
  try {
    await tx("transcripts", "readwrite", (s) => s.put(t));
  } catch {
    /* armazenamento indisponível */
  }
}

export async function deleteTranscript(id: string): Promise<void> {
  try {
    await tx("transcripts", "readwrite", (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

export async function getProgress(key: string): Promise<JobProgressRecord | undefined> {
  try {
    return await tx<JobProgressRecord | undefined>("progress", "readonly", (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function saveProgress(rec: JobProgressRecord): Promise<void> {
  try {
    await tx("progress", "readwrite", (s) => s.put(rec));
  } catch {
    /* ignore */
  }
}

export async function clearProgress(key: string): Promise<void> {
  try {
    await tx("progress", "readwrite", (s) => s.delete(key));
  } catch {
    /* ignore */
  }
}

export async function listProgress(): Promise<JobProgressRecord[]> {
  try {
    return await tx<JobProgressRecord[]>("progress", "readonly", (s) => s.getAll());
  } catch {
    return [];
  }
}
