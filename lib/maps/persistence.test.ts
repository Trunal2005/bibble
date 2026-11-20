import { afterEach, describe, expect, it, vi } from "vitest";

import { mapToRows, rowsToMap, saveMapToSupabase } from "./persistence";
import type { LearningMap } from "@/types/map";

const map: LearningMap = {
  id: "map-1",
  title: "Learning",
  description: "A small map",
  category: "Personal growth",
  accent: "lavender",
  bibbles: [
    {
      id: "b-1",
      title: "Start",
      description: "Begin",
      status: "learning",
      progress: 25,
      position: { x: 10, y: 20 },
      resources: [{ id: "r-1", label: "Guide", url: "https://example.com" }],
      notes: "Keep going",
    },
    {
      id: "b-2",
      title: "Continue",
      description: "",
      status: "not-started",
      progress: 0,
      position: { x: 40, y: 20 },
      resources: [],
      notes: "",
    },
  ],
  edges: [{ id: "e-1", source: "b-1", target: "b-2" }],
};

const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() }, from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("migration authentication confirmation", () => {
  it("does not acknowledge an upload when cloud persistence is unconfigured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await saveMapToSupabase(map, "account-a")).toBe(false);
  });
  it.each([null, { id: "account-b" }])("rejects a missing or different account: %j", async (user) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-key");
    client.auth.getUser.mockResolvedValue({ data: { user } });
    expect(await saveMapToSupabase(map, "account-a")).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("map persistence mapping", () => {
  it("stores nested bibble positions and ownership-free rows", () => {
    const rows = mapToRows(map);
    expect(rows.map).toEqual({ id: "map-1", title: "Learning", description: "A small map", category: "Personal growth", accent: "lavender" });
    expect(rows.bibbles[0]).toMatchObject({ map_id: "map-1", position_x: 10, position_y: 20 });
    expect(rows.bibbles[0]).not.toHaveProperty("user_id");
    expect(rows.edges[0]).toMatchObject({ map_id: "map-1", source_id: "b-1", target_id: "b-2" });
  });

  it("round-trips a map through database row shapes", () => {
    const rows = mapToRows(map);
    const domainMap = rowsToMap(rows.map, rows.bibbles, rows.edges);
    expect(domainMap).toEqual(map);
    expect(domainMap.bibbles[0]).not.toHaveProperty("map_id");
    expect(domainMap.edges[0]).not.toHaveProperty("source_id");
    expect(domainMap.edges[0]).not.toHaveProperty("target_id");
  });
});
