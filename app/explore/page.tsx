"use client";

import { MapCard } from "@/components/explore/map-card";
import { SiteHeader } from "@/components/site-header";
import { categories } from "@/data/categories";
import { sampleMaps } from "@/data/sample-maps";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { LearningMap } from "@/types/map";
import { deleteMapFromSupabase, listMapsFromSupabase } from "@/lib/maps/persistence";
import {
  BASE_STORAGE_KEY_DELETED,
  BASE_STORAGE_KEY_MAPS,
  getUserScopedKey,
  migrateGuestMapsToAccount,
} from "@/lib/maps/sync";
import { Search, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All maps");
  const [userId, setUserId] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<string | null>(null);

  const storageKey = getUserScopedKey(BASE_STORAGE_KEY_MAPS, userId);
  const deletedKey = getUserScopedKey(BASE_STORAGE_KEY_DELETED, userId);

  // Read user-saved/custom maps and the IDs of system maps the user removed.
  const [storedMaps, setStoredMaps] = useLocalStorage<LearningMap[]>(storageKey, []);
  const [deletedMapIds, setDeletedMapIds] = useLocalStorage<string[]>(deletedKey, []);
  const [remoteMaps, setRemoteMaps] = useState<LearningMap[]>([]);

  useEffect(() => {
    let isMounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then(async (data: { user: { id: string } | null }) => {
        if (!isMounted) return;
        const currentUid = data?.user?.id ?? null;
        setUserId(currentUid);

        if (currentUid) {
          const result = await migrateGuestMapsToAccount(currentUid);
          if (isMounted && result.migratedCount > 0) {
            setSyncToast(`Synced ${result.migratedCount} offline map${result.migratedCount > 1 ? "s" : ""} to your account! 🍓`);
            window.setTimeout(() => setSyncToast(null), 5000);
          }
        }
      })
      .catch(() => {
        if (isMounted) setUserId(null);
      })
      .finally(() => {
        if (isMounted) {
          listMapsFromSupabase().then(setRemoteMaps).catch(() => setRemoteMaps([]));
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Merge: stored maps override matching sample maps, user-created maps are appended,
  // and system maps the user deleted are left out entirely (even if an override exists).
  const allMaps = useMemo(() => {
    const merged = sampleMaps
      .filter((sample) => !deletedMapIds.includes(sample.id))
      .map((sample) => {
        const saved = storedMaps.find((m) => m.id === sample.id);
        return saved ?? sample;
      });
    for (const stored of storedMaps) {
      if (deletedMapIds.includes(stored.id)) continue;
      if (!merged.some((m) => m.id === stored.id)) {
        merged.push(stored);
      }
    }
    for (const remote of remoteMaps) {
      if (deletedMapIds.includes(remote.id)) continue;
      const existingIndex = merged.findIndex((map) => map.id === remote.id);
      if (existingIndex >= 0) merged[existingIndex] = remote;
      else merged.push(remote);
    }
    return merged;
  }, [storedMaps, deletedMapIds, remoteMaps]);

  const maps = useMemo(
    () => allMaps.filter(
      (map) =>
        (category === "All maps" || map.category === category) &&
        `${map.title} ${map.description}`.toLowerCase().includes(query.toLowerCase()),
    ),
    [allMaps, category, query],
  );

  // System maps are hidden via an ID list; user-created maps are removed from storage.
  const handleDeleteMap = async (mapId: string) => {
    if (sampleMaps.some((map) => map.id === mapId)) {
      setDeletedMapIds((currentIds) =>
        currentIds.includes(mapId) ? currentIds : [...currentIds, mapId],
      );
      return;
    }
    if (await deleteMapFromSupabase(mapId)) {
      setStoredMaps((currentMaps) => currentMaps.filter((map) => map.id !== mapId));
      setRemoteMaps((currentMaps) => currentMaps.filter((map) => map.id !== mapId));
    }
  };

  return (
    <main className="app-page">
      <SiteHeader />
      {syncToast && (
        <aside className="cozy-toast" role="status" aria-live="polite">
          <p>{syncToast}</p>
        </aside>
      )}
      <section className="page-intro">
        <div>
          <span className="eyebrow"><Star size={14} /> Small worlds of knowledge</span>
          <h1>Find a map that feels like yours.</h1>
          <p>Browse a few learning worlds made for wandering, connecting, and coming back to.</p>
        </div>
        <div className="explore-stats"><strong>{allMaps.length}</strong><span>maps<br />to explore</span></div>
      </section>
      <section className="explore-controls">
        <label className="search-field">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search maps" aria-label="Search maps" />
        </label>
        <div className="category-row" role="group" aria-label="Filter by category">
          <SlidersHorizontal size={16} />
          {categories.map((item) => (
            <button key={item} className={category === item ? "category-active" : ""} onClick={() => setCategory(item)}>{item}</button>
          ))}
        </div>
      </section>
      <section className="map-grid">
        {maps.map((map) => (
          <MapCard
            key={map.id}
            map={map}
            onDelete={handleDeleteMap}
          />
        ))}
      </section>
      {maps.length === 0 && (
        <div className="empty-state">
          <Star size={22} /><h2>No bibbles here yet.</h2><p>Try a different search or category.</p>
        </div>
      )}
    </main>
  );
}
