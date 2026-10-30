// Shared, browser-safe types and helpers for DeepGuard forensic results.

export type ThreatLevel = "authentic" | "suspicious" | "manipulated";

export type FaceBox = {
  /** [ymin, xmin, ymax, xmax] normalized 0-1000 */
  box: [number, number, number, number];
  score: number;
  label: string;
};

export type Indicator = { label: string; severity: "low" | "medium" | "high" };

export type FrameResult = {
  level: ThreatLevel;
  score: number;
  confidence: number;
  summary: string;
  indicators: Indicator[];
  faces: FaceBox[];
};

export type VideoFrameScore = { index: number; time: number; score: number; faces: FaceBox[] };

export type VideoResult = {
  level: ThreatLevel;
  score: number;
  confidence: number;
  summary: string;
  indicators: Indicator[];
  frames: VideoFrameScore[];
};

export type AudioSegment = { start: number; end: number; score: number; note: string };

export type AudioResult = {
  level: ThreatLevel;
  score: number;
  confidence: number;
  summary: string;
  indicators: Indicator[];
  segments: AudioSegment[];
  transcript: string;
};

export type AnalysisResponse<T> =
  | { ok: true; result: T; latencyMs: number }
  | { ok: false; status: number; error: string };

/** Score thresholds: below 35 is authentic, 35-64 suspicious, 65+ manipulated. */
export function threatLevel(score: number): ThreatLevel {
  if (score >= 65) return "manipulated";
  if (score >= 35) return "suspicious";
  return "authentic";
}

export const LEVEL_LABEL: Record<ThreatLevel, string> = {
  authentic: "Authentic",
  suspicious: "Suspicious",
  manipulated: "Manipulated",
};

export function clamp(n: unknown, min: number, max: number, fallback = 0): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

type Loose = Partial<
  Record<
    | "severity" | "label" | "box" | "score" | "confidence" | "summary" | "indicators"
    | "faces" | "frames" | "index" | "transcript" | "segments" | "start" | "end" | "note",
    unknown
  >
>;

function obj(v: unknown): Loose {
  return v && typeof v === "object" ? (v as Loose) : {};
}

export function normalizeIndicators(v: unknown): Indicator[] {
  return arr(v)
    .slice(0, 8)
    .map((i) => {
      const o = obj(i);
      const sev = str(o.severity);
      return {
        label: str(o.label, str(i)).slice(0, 140),
        severity: (sev === "high" || sev === "medium" ? sev : "low") as Indicator["severity"],
      };
    })
    .filter((i) => i.label.length > 0);
}

export function normalizeFaces(v: unknown): FaceBox[] {
  return arr(v)
    .slice(0, 12)
    .map((f) => {
      const o = obj(f);
      const b = arr(o.box).map((n) => clamp(n, 0, 1000));
      if (b.length !== 4) return null;
      const [ymin = 0, xmin = 0, ymax = 0, xmax = 0] = b;
      if (ymax <= ymin || xmax <= xmin) return null;
      return {
        box: [ymin, xmin, ymax, xmax] as [number, number, number, number],
        score: clamp(o.score, 0, 100),
        label: str(o.label, "face").slice(0, 40),
      };
    })
    .filter((f): f is FaceBox => f !== null);
}

export function normalizeFrame(raw: unknown): FrameResult {
  const o = obj(raw);
  const score = clamp(o.score, 0, 100);
  return {
    level: threatLevel(score),
    score,
    confidence: clamp(o.confidence, 0, 100, 50),
    summary: str(o.summary).slice(0, 400),
    indicators: normalizeIndicators(o.indicators),
    faces: normalizeFaces(o.faces),
  };
}

export function normalizeVideo(raw: unknown, times: number[]): VideoResult {
  const o = obj(raw);
  const frames: VideoFrameScore[] = times.map((time, index) => {
    const match = arr(o.frames).map(obj).find((f) => Number(f.index) === index);
    return {
      index,
      time,
      score: clamp(match?.score, 0, 100),
      faces: normalizeFaces(match?.faces),
    };
  });
  const maxFrame = frames.reduce((m, f) => Math.max(m, f.score), 0);
  const score = clamp(o.score, 0, 100, maxFrame);
  return {
    level: threatLevel(score),
    score,
    confidence: clamp(o.confidence, 0, 100, 50),
    summary: str(o.summary).slice(0, 600),
    indicators: normalizeIndicators(o.indicators),
    frames,
  };
}

export function normalizeAudio(raw: unknown, durationSec: number): AudioResult {
  const o = obj(raw);
  const score = clamp(o.score, 0, 100);
  const maxT = durationSec > 0 ? durationSec : Number.MAX_SAFE_INTEGER;
  return {
    level: threatLevel(score),
    score,
    confidence: clamp(o.confidence, 0, 100, 50),
    summary: str(o.summary).slice(0, 600),
    indicators: normalizeIndicators(o.indicators),
    transcript: str(o.transcript).slice(0, 600),
    segments: arr(o.segments)
      .slice(0, 20)
      .map((s) => {
        const so = obj(s);
        const start = clamp(so.start, 0, maxT);
        const end = clamp(so.end, start, maxT, start);
        return { start, end, score: clamp(so.score, 0, 100), note: str(so.note).slice(0, 140) };
      })
      .filter((s) => s.end > s.start),
  };
}

/**
 * Backpressure gate: only one inference may be in flight per pipeline.
 * Frames that arrive while busy are dropped (counted) instead of queued,
 * so the live stream never builds up latency.
 */
export function createInflightGate() {
  let busy = false;
  let sent = 0;
  let dropped = 0;
  return {
    tryAcquire(): boolean {
      if (busy) {
        dropped++;
        return false;
      }
      busy = true;
      sent++;
      return true;
    },
    release() {
      busy = false;
    },
    stats: () => ({ sent, dropped, busy }),
    reset() {
      busy = false;
      sent = 0;
      dropped = 0;
    },
  };
}
