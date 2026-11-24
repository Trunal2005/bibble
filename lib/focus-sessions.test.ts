import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  focusPrefix,
  focusEntries,
  loadFocusSessions,
  loadActiveFocusSessions,
  recordActiveFocusSession,
  resetActiveFocusHistory,
  setFocusIdentity,
  syncFocusHistory,
  upgradeLegacyFocusSessions,
} from "./focus-sessions";
const client = vi.hoisted(() => ({ auth: { getUser: vi.fn() }, rpc: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}
const session = (id = "session") => ({
  id,
  minutes: 25,
  completedAt: "2026-11-22T00:00:00.000Z",
  topic: "Study",
});
let storage: Storage;
beforeEach(() => {
  vi.resetAllMocks();
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent: vi.fn() });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test");
  setFocusIdentity(null);
  client.auth.getUser.mockResolvedValue({ data: { user: { id: "A" } } });
});
afterEach(() => {
  setFocusIdentity(undefined);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("private immutable focus storage", () => {
  it("separate session keys preserve simultaneous tab completions and repeated IDs", () => {
    recordActiveFocusSession(session("one"));
    recordActiveFocusSession(session("two"));
    recordActiveFocusSession(session("one"));
    expect(loadFocusSessions(storage, null)).toHaveLength(2);
  });
  it("switching accounts or returning to guest never exposes private sessions", () => {
    setFocusIdentity("A");
    recordActiveFocusSession(session("private"));
    setFocusIdentity("B");
    expect(loadActiveFocusSessions()).toEqual([]);
    setFocusIdentity(null);
    expect(loadActiveFocusSessions()).toEqual([]);
    setFocusIdentity("A");
    expect(loadActiveFocusSessions()).toEqual([session("private")]);
  });
  it("legacy sessions migrate once and unreadable originals remain untouched", () => {
    storage.setItem("bibble-focus-sessions", JSON.stringify([session()]));
    upgradeLegacyFocusSessions(storage);
    upgradeLegacyFocusSessions(storage);
    expect(loadFocusSessions(storage, null)).toEqual([session()]);
    expect(storage.getItem("bibble-focus-sessions")).toBeNull();
    storage.setItem("bibble-focus-sessions", "broken");
    expect(() => upgradeLegacyFocusSessions(storage)).toThrow();
    expect(storage.getItem("bibble-focus-sessions")).toBe("broken");
  });
});
describe("acknowledged guest migration", () => {
  it("failed uploads preserve originals and their claim prevents another account importing them", async () => {
    recordActiveFocusSession(session("guest"));
    client.rpc
      .mockResolvedValueOnce({ data: { generation: "gen-A", sessions: [] } })
      .mockResolvedValueOnce({ error: { message: "offline" } });
    await expect(syncFocusHistory("A", storage)).rejects.toThrow(
      "Unsynced sessions remain",
    );
    expect(focusEntries(storage, null)).toHaveLength(1);
    expect(loadFocusSessions(storage, null)).toEqual([]);
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "B" } } });
    client.rpc.mockResolvedValue({
      data: { generation: "gen-B", sessions: [] },
    });
    await syncFocusHistory("B", storage);
    expect(loadFocusSessions(storage, "B")).toEqual([]);
    expect(focusEntries(storage, null)).toHaveLength(1);
  });
  it("a successful retry acknowledges IDs before removing the original", async () => {
    recordActiveFocusSession(session("guest"));
    client.rpc
      .mockResolvedValueOnce({ data: { generation: "gen-A", sessions: [] } })
      .mockResolvedValueOnce({
        data: { generation: "gen-A", sessions: [session("guest")] },
      });
    await syncFocusHistory("A", storage);
    expect(focusEntries(storage, null)).toHaveLength(0);
    expect(loadFocusSessions(storage, "A")).toEqual([session("guest")]);
    expect(client.rpc).toHaveBeenLastCalledWith(
      "sync_focus_sessions",
      expect.objectContaining({
        p_owner: "A",
        p_generation: "gen-A",
        p_sessions: [session("guest")],
      }),
    );
  });
  it("wrong identity cannot acknowledge a migration", async () => {
    recordActiveFocusSession(session("guest"));
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "B" } } });
    await expect(syncFocusHistory("A", storage)).rejects.toThrow("verified");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(focusEntries(storage, null)).toHaveLength(1);
  });
  it("quota failures cannot delete guest originals", async () => {
    recordActiveFocusSession(session("guest"));
    const original = storage.setItem;
    storage.setItem = (key, value) => {
      if (key.startsWith(`${focusPrefix("A")}session:`))
        throw new Error("quota");
      original(key, value);
    };
    client.rpc.mockResolvedValue({
      data: { generation: "gen-A", sessions: [] },
    });
    await expect(syncFocusHistory("A", storage)).rejects.toThrow("quota");
    expect(focusEntries(storage, null)).toHaveLength(1);
  });
});
describe("reset generations", () => {
  it("remote reset cannot resurrect old pending entries", async () => {
    storage.setItem(`${focusPrefix("A")}generation`, "old");
    setFocusIdentity("A");
    recordActiveFocusSession(session("old"));
    client.rpc.mockResolvedValue({ data: { generation: "new", sessions: [] } });
    await syncFocusHistory("A", storage);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(loadFocusSessions(storage, "A")).toEqual([]);
    expect(focusEntries(storage, "A")).toHaveLength(1);
  });
  it("failed reset preserves data; confirmed reset affects only the active owner", async () => {
    storage.setItem(`${focusPrefix("A")}generation`, "old");
    setFocusIdentity("A");
    recordActiveFocusSession(session("A"));
    setFocusIdentity("B");
    recordActiveFocusSession(session("B"));
    setFocusIdentity("A");
    client.rpc.mockResolvedValueOnce({ error: { message: "offline" } });
    await expect(resetActiveFocusHistory()).rejects.toThrow("preserved");
    expect(loadFocusSessions(storage, "A")).toHaveLength(1);
    client.rpc.mockResolvedValueOnce({ data: "new" });
    await resetActiveFocusHistory();
    expect(loadFocusSessions(storage, "A")).toEqual([]);
    expect(loadFocusSessions(storage, "B")).toHaveLength(1);
  });
  it("an old in-flight pull cannot roll back a confirmed local reset", async () => {
    storage.setItem(`${focusPrefix("A")}generation`, "old");
    let resolvePull: (value: unknown) => void = () => {};
    client.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolvePull = resolve;
      }),
    );
    const pending = syncFocusHistory("A", storage);
    await Promise.resolve();
    storage.setItem(`${focusPrefix("A")}generation`, "new");
    resolvePull({ data: { generation: "old", sessions: [] } });
    await expect(pending).rejects.toThrow("superseded");
    expect(storage.getItem(`${focusPrefix("A")}generation`)).toBe("new");
  });
});
