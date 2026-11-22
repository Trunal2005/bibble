"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  setFocusIdentity,
  syncFocusHistory,
  upgradeLegacyFocusSessions,
} from "@/lib/focus-sessions";

export function FocusHistoryProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!userId) return;
      void syncFocusHistory(userId)
        .then(() => {
          if (active) setError("");
        })
        .catch((e) => {
          if (active)
            setError(e instanceof Error ? e.message : "History sync failed.");
        });
    };
    queueMicrotask(() => {
      if (!active) return;
      setFocusIdentity(userId);
      try {
        upgradeLegacyFocusSessions(window.localStorage);
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Legacy history could not be restored.",
        );
      }
      setReady(true);
      sync();
    });
    const timer = setInterval(sync, 30_000);
    window.addEventListener("online", sync);
    // Record events trigger immediate retries; sync completion does not recursively
    // trigger another sync because only pending records initiate this event.
    window.addEventListener("bibble-focus-session-recorded", sync);
    let unsubscribe = () => {};
    if (
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ) {
      const { data } = createClient().auth.onAuthStateChange(
        (_event, session) => {
          if ((session?.user.id ?? null) !== userId) {
            setFocusIdentity(undefined);
            setReady(false);
            router.refresh();
          }
        },
      );
      unsubscribe = () => data.subscription.unsubscribe();
    }
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("online", sync);
      window.removeEventListener("bibble-focus-session-recorded", sync);
    };
  }, [userId, router]);
  return (
    <>
      {!ready && <p role="status">Loading your study workspace…</p>}
      {children}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              if (userId)
                void syncFocusHistory(userId)
                  .then(() => setError(""))
                  .catch((e) => setError(e.message));
            }}
          >
            Retry focus history sync
          </button>
        </div>
      )}
    </>
  );
}
