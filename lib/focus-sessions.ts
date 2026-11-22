import type { FocusSession } from "@/types/progress";
import { createClient } from "@/lib/supabase/client";

export const FOCUS_CHANGE = "bibble-focus-history-change";
type Entry = {
  session: FocusSession;
  generation: string | null;
  acknowledged: boolean;
  claimedBy?: string;
  guestKey?: string;
  guestValue?: string;
};
let activeUser: string | null | undefined;
const running = new Map<string, Promise<void>>();
export const focusPrefix = (userId: string | null) =>
  `bibble-focus-v2:${userId ?? "guest"}:`;
const metaKey = (userId: string | null) => `${focusPrefix(userId)}generation`;
const generation = (storage: Storage, userId: string | null) =>
  storage.getItem(metaKey(userId)) ?? (userId ? null : "guest");
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(FOCUS_CHANGE));
}
export function setFocusIdentity(userId: string | null | undefined) {
  activeUser = userId;
  notify();
}
function identity() {
  if (activeUser === undefined)
    throw new Error("Your study workspace is still loading.");
  return activeUser;
}

export function validFocusSession(value: unknown): value is FocusSession {
  if (!value || typeof value !== "object") return false;
  const s = value as FocusSession;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    s.id.length <= 160 &&
    Number.isInteger(s.minutes) &&
    s.minutes >= 1 &&
    s.minutes <= 1440 &&
    typeof s.completedAt === "string" &&
    Number.isFinite(Date.parse(s.completedAt)) &&
    ["roomId", "roomName", "topic", "note"].every((key) => {
      const text = s[key as keyof FocusSession];
      return (
        text === undefined ||
        (typeof text === "string" &&
          text.length <= (key === "note" ? 2000 : 200))
      );
    })
  );
}
export function focusEntries(storage: Storage, userId: string | null) {
  const prefix = `${focusPrefix(userId)}session:`;
  const entries: { key: string; value: string; entry: Entry }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const value = storage.getItem(key);
    if (!value) continue;
    try {
      const entry = JSON.parse(value) as Entry;
      if (
        validFocusSession(entry.session) &&
        (entry.generation === null || typeof entry.generation === "string")
      )
        entries.push({ key, value, entry });
    } catch {
      /* Preserve unreadable originals rather than overwriting them. */
    }
  }
  return entries;
}
export function loadFocusSessions(
  storage: Storage,
  userId: string | null,
): FocusSession[] {
  const current = generation(storage, userId);
  return focusEntries(storage, userId)
    .filter(
      ({ entry }) =>
        (userId !== null || !entry.claimedBy) &&
        (entry.generation === current || entry.generation === null),
    )
    .map(({ entry }) => entry.session)
    .sort(
      (a, b) =>
        Date.parse(b.completedAt) - Date.parse(a.completedAt) ||
        a.id.localeCompare(b.id),
    );
}
export function loadActiveFocusSessions() {
  return typeof window === "undefined" || activeUser === undefined
    ? []
    : loadFocusSessions(window.localStorage, activeUser);
}
export function upgradeLegacyFocusSessions(storage: Storage) {
  const raw = storage.getItem("bibble-focus-sessions");
  if (!raw) return;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(validFocusSession))
    throw new Error(
      "Legacy focus history could not be migrated; its original data is preserved.",
    );
  for (const session of parsed) {
    const key = `${focusPrefix(null)}session:${encodeURIComponent(session.id)}`;
    if (!storage.getItem(key))
      storage.setItem(
        key,
        JSON.stringify({
          session,
          generation: generation(storage, null),
          acknowledged: false,
        }),
      );
  }
  storage.removeItem("bibble-focus-sessions");
}
export function recordActiveFocusSession(
  input: Omit<FocusSession, "id"> & { id?: string },
): FocusSession {
  const userId = identity(),
    storage = window.localStorage;
  const session = { ...input, id: input.id ?? crypto.randomUUID() };
  if (!validFocusSession(session))
    throw new Error(
      "Use a valid date, 1–1440 minutes, and bounded session text.",
    );
  // One key per immutable session avoids lost read/modify/write array updates
  // when two browser tabs finish different timers simultaneously.
  const key = `${focusPrefix(userId)}session:${encodeURIComponent(session.id)}`;
  if (!storage.getItem(key))
    storage.setItem(
      key,
      JSON.stringify({
        session,
        generation: generation(storage, userId),
        acknowledged: false,
      }),
    );
  notify();
  return session;
}
function configured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
type CloudHistory = { generation: string; sessions: FocusSession[] };
function cloudHistory(data: unknown): CloudHistory {
  const value = data as CloudHistory;
  if (
    !value ||
    typeof value.generation !== "string" ||
    !Array.isArray(value.sessions) ||
    !value.sessions.every(validFocusSession)
  )
    throw new Error(
      "Cloud history response was invalid. Local sessions are preserved.",
    );
  return value;
}
export async function syncFocusHistory(
  userId: string,
  storage: Storage = window.localStorage,
): Promise<void> {
  if (running.has(userId)) return running.get(userId);
  const work = (async () => {
    const baseline = generation(storage, userId);
    if (!configured())
      throw new Error(
        "Cloud history is unavailable. Sessions remain in this browser.",
      );
    const client = createClient();
    const auth = await client.auth.getUser();
    if (auth.error || auth.data.user?.id !== userId)
      throw new Error(
        "Your account could not be verified. Local sessions are preserved.",
      );
    const pull = await client.rpc("sync_focus_sessions", {
      p_owner: userId,
      p_generation: null,
      p_sessions: [],
    });
    if (pull.error)
      throw new Error(
        "History sync failed. Check your connection and focus-history migration, then retry.",
      );
    const remote = cloudHistory(pull.data);
    if (
      generation(storage, userId) !== baseline &&
      generation(storage, userId) !== remote.generation
    )
      throw new Error(
        "This sync was superseded by a history reset. Please retry.",
      );
    storage.setItem(metaKey(userId), remote.generation);
    // Originals stay in the guest namespace until this specific account's RPC
    // acknowledges them; a failed upload or quota error cannot delete them.
    const claimedGuests = new Map<string, { key: string; value: string }>();
    for (const guest of focusEntries(storage, null).filter(
      ({ entry }) =>
        entry.generation === generation(storage, null) &&
        (!entry.claimedBy || entry.claimedBy === userId),
    )) {
      const claimedValue = JSON.stringify({
        ...guest.entry,
        claimedBy: userId,
      });
      storage.setItem(guest.key, claimedValue);
      claimedGuests.set(guest.entry.session.id, {
        key: guest.key,
        value: claimedValue,
      });
      const key = `${focusPrefix(userId)}session:${encodeURIComponent(guest.entry.session.id)}`;
      if (!storage.getItem(key))
        storage.setItem(
          key,
          JSON.stringify({
            ...guest.entry,
            generation: remote.generation,
            acknowledged: false,
            guestKey: guest.key,
            guestValue: claimedValue,
          }),
        );
    }
    const apply = (history: CloudHistory) => {
      if (history.generation !== remote.generation)
        throw new Error("History was reset elsewhere. Reload before syncing.");
      for (const session of history.sessions) {
        const key = `${focusPrefix(userId)}session:${encodeURIComponent(session.id)}`;
        const prior = storage.getItem(key);
        let entry: Partial<Entry> = {};
        try {
          entry = prior ? JSON.parse(prior) : {};
        } catch {
          /* Preserve raw invalid data elsewhere. */
        }
        storage.setItem(
          key,
          JSON.stringify({
            session,
            generation: history.generation,
            acknowledged: true,
          }),
        );
        if (
          entry.guestKey &&
          storage.getItem(entry.guestKey) === entry.guestValue
        )
          storage.removeItem(entry.guestKey);
        const guest = claimedGuests.get(session.id);
        if (guest && storage.getItem(guest.key) === guest.value)
          storage.removeItem(guest.key);
      }
    };
    apply(remote);
    const pending = focusEntries(storage, userId).filter(
      ({ entry }) =>
        !entry.acknowledged &&
        (entry.generation === null || entry.generation === remote.generation),
    );
    for (let index = 0; index < pending.length; index += 100) {
      const batch = pending
        .slice(index, index + 100)
        .map(({ entry }) => entry.session);
      const saved = await client.rpc("sync_focus_sessions", {
        p_owner: userId,
        p_generation: remote.generation,
        p_sessions: batch,
      });
      if (saved.error)
        throw new Error(
          saved.error.code === "PT409"
            ? "History was reset on another device. Earlier local records are retained for recovery."
            : "Cloud upload failed. Unsynced sessions remain in this browser.",
        );
      apply(cloudHistory(saved.data));
    }
    notify();
  })();
  running.set(userId, work);
  try {
    await work;
  } finally {
    running.delete(userId);
    notify();
  }
}
export async function resetActiveFocusHistory() {
  const userId = identity(),
    storage = window.localStorage;
  if (!userId) {
    const next = crypto.randomUUID();
    storage.setItem(metaKey(null), next);
    for (const { key, entry } of focusEntries(storage, null))
      if (!entry.claimedBy && entry.generation !== next)
        storage.removeItem(key);
    notify();
    return;
  }
  // Do not claim a cloud reset succeeded offline or erase pending work first.
  if (!configured())
    throw new Error("Reconnect before resetting account history.");
  const client = createClient(),
    expected = generation(storage, userId);
  if (!expected) throw new Error("Sync your history before resetting it.");
  const { data, error } = await client.rpc("reset_focus_history", {
    p_owner: userId,
    p_expected_generation: expected,
  });
  if (error || typeof data !== "string")
    throw new Error(
      "Reset could not be confirmed. Your local history is preserved; sync and retry.",
    );
  storage.setItem(metaKey(userId), data);
  for (const { key, entry } of focusEntries(storage, userId))
    if (entry.generation !== data) storage.removeItem(key);
  for (const { key, entry } of focusEntries(storage, null))
    if (entry.claimedBy === userId) storage.removeItem(key);
  notify();
}
