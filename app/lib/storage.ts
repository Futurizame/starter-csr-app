/**
 * Typed, failure-tolerant wrapper around localStorage.
 *
 * Private-mode browsers and quota errors throw on read and write, so every
 * access is guarded and falls back to the caller's default. Keeping this in one
 * module means persistence can be swapped for a server later without touching
 * components.
 */
export type Codec<T> = {
  parse: (raw: unknown) => T | null;
};

export function readStored<T>(key: string, codec: Codec<T>, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return codec.parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled. In-memory state stays correct, so
    // dropping the write is preferable to crashing the app.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // See writeStored.
  }
}
