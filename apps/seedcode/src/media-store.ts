/**
 * MediaStore — process-lifetime LRU cache for binary media captured by tools
 * (screenshots, readMedia, etc.).
 *
 * Tools store their binary data here and return only a lightweight { mediaId }
 * reference in the tool result. ReplApp injects the actual data into the next
 * streamText call as a `file` content part, preventing large base64 payloads
 * from accumulating in the messages history.
 *
 * LRU eviction: once MAX_ENTRIES is reached, the oldest entry is dropped.
 * Screenshots are typically ~300–800 KB each; 5 entries ≈ 4 MB max.
 */

export interface StoredMedia {
  data: string;      // base64 data-URL, e.g. "data:image/png;base64,..."
  mediaType: string; // MIME type, e.g. "image/png"
  byteSize: number;
  capturedAt: number;
}

const MAX_ENTRIES = 5;

let _counter = 0;

// Map preserves insertion order — we use this for LRU (oldest = first key)
const store = new Map<string, StoredMedia>();

/** Save media and return a unique ID (e.g. "media_3"). Evicts oldest if full. */
export function storeMedia(entry: Omit<StoredMedia, 'capturedAt'>): string {
  if (store.size >= MAX_ENTRIES) {
    // Map.keys() iterates in insertion order; first key is oldest
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  const id = `media_${++_counter}`;
  store.set(id, { ...entry, capturedAt: Date.now() });
  return id;
}

/** Retrieve stored media by ID. Returns undefined if not found or evicted. */
export function getMedia(id: string): StoredMedia | undefined {
  return store.get(id);
}

/** Remove a specific entry */
export function deleteMedia(id: string): void {
  store.delete(id);
}

/** Clear all stored media (called on /clear) */
export function clearMediaStore(): void {
  store.clear();
  _counter = 0;
}

/** Return all currently stored IDs in insertion order (oldest first) */
export function allMediaIds(): string[] {
  return [...store.keys()];
}
