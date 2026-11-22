import type { LearningMap } from '@/types/map';
import { createClient } from '@/lib/supabase/client';

export type MapSummary = Pick<LearningMap, 'id' | 'title' | 'description' | 'category' | 'accent'> & {
  bibbleCount: number; progress: number; updatedAt: string;
};
export type SummaryCursor = { updatedAt: string; id: string };
export type SummaryPage = { maps: MapSummary[]; next: SummaryCursor | null };
export function summarizeMap(map: LearningMap): MapSummary {
  return { id: map.id, title: map.title, description: map.description, category: map.category, accent: map.accent,
    bibbleCount: map.bibbles.length, progress: map.bibbles.length ? Math.round(map.bibbles.reduce((sum, b) => sum + b.progress, 0) / map.bibbles.length) : 0, updatedAt: '' };
}
export function mergeSummaries(local: MapSummary[], remote: MapSummary[], deleted: string[], query: string, category: string) {
  const merged = new Map(local.map(map => [map.id, map]));
  for (const map of remote) merged.set(map.id, map);
  const hidden = new Set(deleted), search = query.toLowerCase().trim();
  return [...merged.values()].filter(map => !hidden.has(map.id) && (category === 'All maps' || map.category === category) && `${map.title} ${map.description}`.toLowerCase().includes(search));
}
export async function listMapSummaries(query: string, category: string, cursor: SummaryCursor | null = null): Promise<SummaryPage> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return { maps: [], next: null };
  const client = createClient();
  const auth = await client.auth.getUser();
  if (auth.error && auth.error.name !== 'AuthSessionMissingError') throw new Error('Could not verify your session. Please retry.');
  if (!auth.data.user) return { maps: [], next: null };
  const { data, error } = await client.rpc('list_learning_map_summaries', {
    p_search: query.trim(), p_category: category === 'All maps' ? null : category,
    p_cursor_time: cursor?.updatedAt ?? null, p_cursor_id: cursor?.id ?? null, p_limit: 25,
  });
  if (error || !Array.isArray(data)) throw new Error('Cloud maps could not load. Check your connection and summaries migration, then retry.');
  const maps = data.slice(0, 25).map(row => ({ id: row.id, title: row.title, description: row.description,
    category: row.category, accent: row.accent, updatedAt: row.updated_at, bibbleCount: Number(row.bibble_count), progress: Number(row.progress) }));
  const last = maps.at(-1);
  return { maps, next: data.length > 25 && last ? { updatedAt: last.updatedAt, id: last.id } : null };
}
