import type { LearningMap } from "@/types/map";
import { saveMapToSupabase } from "@/lib/maps/persistence";
import { sampleMaps } from "@/data/sample-maps";

export const BASE_STORAGE_KEY_MAPS = "bibble-maps";
export const BASE_STORAGE_KEY_DELETED = "bibble-deleted-maps";

/**
 * Returns a user-scoped localStorage key.
 * If userId is provided, returns `${baseKey}:${userId}`.
 * If userId is null/undefined/empty, returns `${baseKey}:guest`.
 */
export function getUserScopedKey(baseKey: string, userId?: string | null): string {
  if (userId && typeof userId === "string" && userId.trim().length > 0) {
    return `${baseKey}:${userId.trim()}`;
  }
  return `${baseKey}:guest`;
}

/**
 * Reads stored maps for a specific user scope, with backwards-compatible
 * migration from legacy un-scoped key if needed.
 */
export function getStoredMapsForScope(userId?: string | null): LearningMap[] {
  if (typeof window === "undefined") return [];
  const scopedKey = getUserScopedKey(BASE_STORAGE_KEY_MAPS, userId);
  try {
    const raw = window.localStorage.getItem(scopedKey);
    if (raw) {
      return JSON.parse(raw) as LearningMap[];
    }

    // Backwards compatibility: Check legacy un-scoped key for guest
    if (!userId) {
      const legacyRaw = window.localStorage.getItem(BASE_STORAGE_KEY_MAPS);
      if (legacyRaw) {
        const legacyMaps = JSON.parse(legacyRaw) as LearningMap[];
        window.localStorage.setItem(scopedKey, legacyRaw);
        return legacyMaps;
      }
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Writes stored maps for a specific user scope.
 */
export function setStoredMapsForScope(maps: LearningMap[], userId?: string | null): void {
  if (typeof window === "undefined") return;
  const scopedKey = getUserScopedKey(BASE_STORAGE_KEY_MAPS, userId);
  try {
    window.localStorage.setItem(scopedKey, JSON.stringify(maps));
  } catch {
    // Ignore storage write errors (e.g. quota exceeded)
  }
}

/**
 * Reconciles local and remote maps into a single consistent list.
 * Deduplicates by ID, giving precedence to remote updates while preserving unique local maps.
 */
export function reconcileLocalAndRemoteMaps(
  localMaps: LearningMap[],
  remoteMaps: LearningMap[]
): LearningMap[] {
  const result: LearningMap[] = [...remoteMaps];
  const remoteIds = new Set(remoteMaps.map((m) => m.id));

  for (const local of localMaps) {
    if (!remoteIds.has(local.id)) {
      result.push(local);
    }
  }

  return result;
}

export interface MigrationResult {
  migratedCount: number;
  migratedIds: string[];
  failedIds: string[];
  errors: string[];
}

/**
 * Migrates guest maps (from `bibble-maps:guest` and legacy `bibble-maps`)
 * to the authenticated Supabase user account.
 * Automatically saves each map to Supabase and copies to user's scoped local storage.
 * Only migrates user-created or customized maps (skips unmodified sample maps).
 */
export async function migrateGuestMapsToAccount(
  userId: string,
  options: { clearGuestStorage?: boolean } = { clearGuestStorage: true }
): Promise<MigrationResult> {
  if (typeof window === "undefined" || !userId) {
    return { migratedCount: 0, migratedIds: [], failedIds: [], errors: [] };
  }

  // 1. Gather candidate guest maps from scoped guest storage and legacy storage
  const guestMaps = getStoredMapsForScope(null);
  let legacyMaps: LearningMap[] = [];
  try {
    const legacyRaw = window.localStorage.getItem(BASE_STORAGE_KEY_MAPS);
    if (legacyRaw) {
      legacyMaps = JSON.parse(legacyRaw) as LearningMap[];
    }
  } catch {
    legacyMaps = [];
  }

  // Combine and deduplicate candidate maps by ID
  const candidateMapById = new Map<string, LearningMap>();
  for (const map of [...legacyMaps, ...guestMaps]) {
    if (map && map.id) {
      candidateMapById.set(map.id, map);
    }
  }

  const sampleIds = new Set(sampleMaps.map((s) => s.id));
  // Filter out untouched sample maps
  const mapsToMigrate = Array.from(candidateMapById.values()).filter((map) => {
    if (!sampleIds.has(map.id)) return true;
    const original = sampleMaps.find((s) => s.id === map.id);
    if (!original) return true;
    return (
      original.title !== map.title ||
      original.description !== map.description ||
      original.bibbles.length !== map.bibbles.length ||
      JSON.stringify(original.bibbles) !== JSON.stringify(map.bibbles)
    );
  });

  if (mapsToMigrate.length === 0) {
    return { migratedCount: 0, migratedIds: [], failedIds: [], errors: [] };
  }

  const migratedIds: string[] = [];
  const failedIds: string[] = [];
  const errors: string[] = [];

  // Read existing user-scoped local maps
  const userMaps = getStoredMapsForScope(userId);
  const userMapIds = new Set(userMaps.map((m) => m.id));

  for (const map of mapsToMigrate) {
    try {
      const success = await saveMapToSupabase(map);
      if (success) {
        migratedIds.push(map.id);
        if (!userMapIds.has(map.id)) {
          userMaps.push(map);
          userMapIds.add(map.id);
        }
      } else {
        failedIds.push(map.id);
        errors.push(`Failed to persist map "${map.title}" (${map.id}) to Supabase.`);
      }
    } catch (err) {
      failedIds.push(map.id);
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  // Update authenticated user's scoped storage with migrated maps
  if (migratedIds.length > 0) {
    setStoredMapsForScope(userMaps, userId);
  }

  // Clean up successfully migrated maps from guest storage
  if (options.clearGuestStorage && migratedIds.length > 0) {
    const migratedSet = new Set(migratedIds);
    const remainingGuestMaps = guestMaps.filter((m) => !migratedSet.has(m.id));
    setStoredMapsForScope(remainingGuestMaps, null);

    // Also update or remove legacy storage key
    if (remainingGuestMaps.length === 0) {
      window.localStorage.removeItem(BASE_STORAGE_KEY_MAPS);
    } else {
      window.localStorage.setItem(BASE_STORAGE_KEY_MAPS, JSON.stringify(remainingGuestMaps));
    }
  }

  return {
    migratedCount: migratedIds.length,
    migratedIds,
    failedIds,
    errors,
  };
}

/**
 * Cleanly resets user-specific cached maps or guest storage on session teardown.
 */
export function clearUserScopedStorage(userId?: string | null): void {
  if (typeof window === "undefined") return;
  const mapKey = getUserScopedKey(BASE_STORAGE_KEY_MAPS, userId);
  const deletedKey = getUserScopedKey(BASE_STORAGE_KEY_DELETED, userId);
  window.localStorage.removeItem(mapKey);
  window.localStorage.removeItem(deletedKey);
}
