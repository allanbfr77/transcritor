import { AppError } from "../types";

export function supportsOpfs(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.storage?.getDirectory &&
    typeof FileSystemFileHandle !== "undefined" &&
    "createWritable" in FileSystemFileHandle.prototype
  );
}

export async function checkSpace(needed: number): Promise<void> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota != null && est.usage != null) {
      const free = est.quota - est.usage;
      if (needed > free * 0.95) {
        throw new AppError(
          "Espaço em disco insuficiente para baixar este arquivo. Libere espaço ou use um arquivo menor.",
          "disk",
        );
      }
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
  }
}

export interface TempFile {
  write: (chunk: Uint8Array) => Promise<void>;
  finish: () => Promise<File>;
  remove: () => Promise<void>;
}

/** Cria um arquivo temporário na Origin Private File System (em disco, não na RAM). */
export async function createTempFile(name: string, type: string): Promise<TempFile> {
  if (!supportsOpfs()) {
    throw new AppError(
      "Seu navegador não suporta armazenamento em disco (OPFS) para arquivos grandes. Use o Chrome ou o Edge atualizado no computador.",
      "opfs",
    );
  }
  const root = await navigator.storage.getDirectory();
  const fileName = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name.replace(/[^\w.-]+/g, "_")}`;
  const handle = await root.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  let closed = false;
  return {
    write: async (chunk) => {
      try {
        await writable.write(chunk as unknown as BufferSource);
      } catch (e) {
        if (e instanceof DOMException && e.name === "QuotaExceededError") {
          throw new AppError("Espaço em disco insuficiente.", "disk");
        }
        throw e;
      }
    },
    finish: async () => {
      await writable.close();
      closed = true;
      const f = await handle.getFile();
      return new File([f], name, { type: type || f.type });
    },
    remove: async () => {
      try {
        if (!closed) await writable.abort();
      } catch {
        /* ignore */
      }
      try {
        await root.removeEntry(fileName);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Remove arquivos temporários antigos deixados por sessões interrompidas. */
export async function cleanupStaleTemp(maxAgeMs = 6 * 3600_000): Promise<void> {
  if (!supportsOpfs()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const iter = root as unknown as AsyncIterable<[string, FileSystemHandle]>;
    for await (const [name] of iter) {
      const m = name.match(/^tmp-(\d+)-/);
      if (m && Date.now() - Number(m[1]) > maxAgeMs) {
        await root.removeEntry(name).catch(() => undefined);
      }
    }
  } catch {
    /* ignore */
  }
}
