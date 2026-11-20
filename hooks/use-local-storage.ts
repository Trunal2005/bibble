"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeLocalMapData } from "@/lib/maps/local-storage";

export function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);
  const skipWrite = useRef(true);

  useEffect(() => {
    skipWrite.current = true;
    let valueTimer: number | undefined;
    let hydrationTimer: number | undefined;
    try {
      const stored = window.localStorage.getItem(key);
      if (stored) {
        const restored = normalizeLocalMapData(key, JSON.parse(stored)) as T;
        valueTimer = window.setTimeout(() => setValue(restored), 0);
      }
    } catch {
      // Preserve unreadable data; loading must not delete a user's saved value.
    } finally {
      // Queued after the setValue timer above, so `hydrated` only turns true once the stored value is in state.
      hydrationTimer = window.setTimeout(() => setHydrated(true), 0);
    }
    return () => {
      window.clearTimeout(valueTimer);
      window.clearTimeout(hydrationTimer);
    };
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipWrite.current) {
      skipWrite.current = false;
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [hydrated, key, value]);

  return [value, setValue, hydrated] as const;
}
