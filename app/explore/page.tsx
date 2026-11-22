"use client";

import { MapCard } from "@/components/explore/map-card";
import { SiteHeader } from "@/components/site-header";
import { categories } from "@/data/categories";
import { sampleMaps } from "@/data/sample-maps";
import { useLocalStorage } from "@/hooks/use-local-storage";
import type { LearningMap } from "@/types/map";
import { deleteMapFromSupabase } from "@/lib/maps/persistence";
import { listMapSummaries, mergeSummaries, summarizeMap, type MapSummary, type SummaryCursor } from "@/lib/maps/summaries";
import { Search, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export default function ExplorePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All maps");
  // Read user-saved/custom maps and the IDs of system maps the user removed.
  const [storedMaps, setStoredMaps] = useLocalStorage<LearningMap[]>("bibble-maps", []);
  const [deletedMapIds, setDeletedMapIds] = useLocalStorage<string[]>("bibble-deleted-maps", []);
  const [remoteMaps, setRemoteMaps] = useState<MapSummary[]>([]);
  const [cursor, setCursor] = useState<SummaryCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef({ active: true });
  useEffect(() => {
    const scope = { active: true };
    generation.current = scope;
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true); setError(''); setRemoteMaps([]); setCursor(null);
      try {
        const page = await listMapSummaries(query, category);
        if (active) { setRemoteMaps(page.maps); setCursor(page.next); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Cloud maps could not load.'); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; scope.active = false; clearTimeout(timer); };
  }, [query, category, retry]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    const requestGeneration = generation.current;
    setLoading(true); setError('');
    try {
      const page = await listMapSummaries(query, category, cursor);
      if (!requestGeneration.active) return;
      setRemoteMaps(current => [...new Map([...current, ...page.maps].map(map => [map.id, map])).values()]);
      setCursor(page.next);
    } catch (e) { if (requestGeneration.active) setError(e instanceof Error ? e.message : 'Cloud maps could not load.'); }
    finally { if (requestGeneration.active) setLoading(false); }
  };

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
    return merged;
  }, [storedMaps, deletedMapIds]);

  const maps = useMemo(
    () => mergeSummaries(allMaps.map(summarizeMap), remoteMaps, deletedMapIds, query, category),
    [allMaps, remoteMaps, deletedMapIds, category, query],
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
      <section className="page-intro">
        <div>
          <span className="eyebrow"><Star size={14} /> Small worlds of knowledge</span>
          <h1>Find a map that feels like yours.</h1>
          <p>Browse a few learning worlds made for wandering, connecting, and coming back to.</p>
        </div>
        <div className="explore-stats"><strong>{maps.length}</strong><span>maps loaded<br />to explore</span></div>
      </section>
      <section className="explore-controls">
        <label className="search-field">
          <Search size={17} />
          <input maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search maps" aria-label="Search maps" />
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
            map={remoteMaps.some(remote => remote.id === map.id) ? map : allMaps.find(local => local.id === map.id) ?? map}
            onDelete={handleDeleteMap}
          />
        ))}
      </section>
      {loading && <p role="status">Loading cloud maps…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => cursor ? void loadMore() : setRetry(value => value + 1)}>Retry cloud maps</button></div>}
      {cursor && <button type="button" disabled={loading} onClick={() => void loadMore()}>Load more maps</button>}
      {!loading && !error && maps.length === 0 && (
        <div className="empty-state">
          <Star size={22} /><h2>No bibbles here yet.</h2><p>Try a different search or category.</p>
        </div>
      )}
    </main>
  );
}
