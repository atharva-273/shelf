/**
 * Storage durability.
 *
 * By default a browser treats IndexedDB as "best effort" — it's allowed to
 * evict the whole origin when the device runs low on space, with no warning.
 * That's the single biggest difference between this and a native app, and it's
 * also the one part of the gap we can close: `navigator.storage.persist()`
 * asks the browser to mark the origin as persistent, after which it won't be
 * evicted automatically.
 *
 * Chrome grants this silently (no prompt) when the site looks meaningful to the
 * user — installed to the home screen, bookmarked, or with enough engagement.
 * Installing as a PWA is the most reliable trigger, which is why the install
 * prompt and this request sit next to each other in Settings.
 *
 * None of this protects against a lost or broken phone. Only the backup file
 * does that.
 */

export interface StorageStatus {
  persisted: boolean
  supported: boolean
  usageBytes?: number
  quotaBytes?: number
}

export async function getStorageStatus(): Promise<StorageStatus> {
  if (!navigator.storage?.estimate) {
    return { persisted: false, supported: false }
  }

  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.() ?? Promise.resolve(false),
    navigator.storage.estimate(),
  ])

  return {
    persisted,
    supported: typeof navigator.storage.persist === 'function',
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
  }
}

/** Returns the resulting persisted state, whether or not we changed it. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator.storage?.persist !== 'function') return false
  if (await navigator.storage.persisted?.()) return true
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
