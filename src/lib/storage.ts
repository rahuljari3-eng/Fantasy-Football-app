// Tiny localStorage wrapper for persisting the last live-refreshed
// projections between visits. Kept async (even though localStorage itself is
// synchronous) so a future swap to a real backend/IndexedDB doesn't change
// any call sites.

export async function getStoredValue(key: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can throw in private-browsing / storage-disabled contexts --
    // treat it the same as "nothing saved yet".
    return null;
  }
}

export async function setStoredValue(key: string, value: string): Promise<void> {
  try {
    window.localStorage.setItem(key, value);
  } catch (err) {
    console.error(`Couldn't save "${key}" to localStorage`, err);
  }
}
