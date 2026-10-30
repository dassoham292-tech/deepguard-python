import { useSyncExternalStore } from "react";

import type { Indicator, ThreatLevel } from "./forensics-types";

export type ScanType = "live" | "video" | "audio";

export type HistoryEntry = {
  id: string;
  type: ScanType;
  createdAt: number;
  title: string;
  level: ThreatLevel;
  score: number;
  confidence: number;
  summary: string;
  indicators: Indicator[];
  thumbnail?: string | undefined;
  meta: Record<string, string | number>;
};

const KEY = "deepguard.history.v1";
const MAX_ENTRIES = 60;
const EMPTY: HistoryEntry[] = [];

let cache: HistoryEntry[] | null = null;
const listeners = new Set<() => void>();

function read(): HistoryEntry[] {
  if (cache) return cache;
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: HistoryEntry[]) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full: drop thumbnails from older entries and retry once.
    const slim = next.map((e, i) => (i > 10 ? { ...e, thumbnail: undefined } : e));
    cache = slim;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      /* give up silently */
    }
  }
  listeners.forEach((l) => l());
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "createdAt">) {
  const full: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  write([full, ...read()].slice(0, MAX_ENTRIES));
  return full;
}

export function removeHistory(id: string) {
  write(read().filter((e) => e.id !== id));
}

export function clearHistory() {
  write([]);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
