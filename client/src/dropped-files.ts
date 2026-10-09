function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** `readEntries` returns a folder in batches until an empty one. */
async function folderEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return entries;
    entries.push(...batch);
  }
}

async function walk(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) return [await fileOf(entry as FileSystemFileEntry)];
  if (!entry.isDirectory) return [];
  const files: File[] = [];
  for (const child of await folderEntries(entry as FileSystemDirectoryEntry)) files.push(...await walk(child));
  return files;
}

/**
 * Files from a drop, including the contents of dropped folders. Entries must be taken
 * synchronously during the drop event, before the data transfer is cleared.
 */
export function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve(Array.from(transfer.files ?? []));
  }
  return Promise.all((entries as FileSystemEntry[]).map(walk)).then((groups) => groups.flat());
}
