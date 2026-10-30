import { FileVideo, Loader2, RotateCcw, ScanSearch, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { analyzeVideoFrames } from "@/lib/forensics.functions";
import type { VideoResult } from "@/lib/forensics-types";
import { threatLevel } from "@/lib/forensics-types";
import { addHistory } from "@/lib/history";
import { captureFrame, formatBytes, formatTime, makeThumb } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

import { FaceOverlay, IndicatorList, LevelBadge, Sparkline, StatTile, ThreatMeter, levelText } from "./threat";

const FRAME_COUNT = 8;
const MAX_BYTES = 500 * 1024 * 1024;

type Phase = { kind: "idle" } | { kind: "extracting"; done: number } | { kind: "analyzing" } | { kind: "done" };

function waitFor(el: HTMLMediaElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const err = () => {
      cleanup();
      reject(new Error("Could not read this video file."));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener("error", err);
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", err, { once: true });
  });
}

async function extractFrames(url: string, count: number, onProgress: (n: number) => void) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.src = url;
  await waitFor(v, "loadeddata");
  const duration = v.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the video length.");
  const times = Array.from({ length: count }, (_, i) =>
    count === 1 ? duration / 2 : duration * 0.04 + (i * (duration * 0.92)) / (count - 1),
  );
  const frames: { time: number; image: string }[] = [];
  for (const t of times) {
    v.currentTime = Math.min(t, Math.max(0, duration - 0.05));
    await waitFor(v, "seeked");
    const image = captureFrame(v, 512, 0.7);
    if (image) frames.push({ time: v.currentTime, image });
    onProgress(frames.length);
  }
  return { duration, frames, aspect: v.videoWidth / v.videoHeight || 16 / 9 };
}

export function VideoDetection() {
  const analyzeFn = analyzeVideoFrames;
  const inputRef = useRef<HTMLInputElement>(null);
  const playerRef = useRef<HTMLVideoElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [frames, setFrames] = useState<{ time: number; image: string }[]>([]);
  const [aspect, setAspect] = useState(16 / 9);
  const [result, setResult] = useState<VideoResult | null>(null);
  const [latency, setLatency] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      toast.error("Please choose a video file (MP4, WebM, MOV).");
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error("That video is larger than 500 MB.");
      return;
    }
    if (url) URL.revokeObjectURL(url);
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setFrames([]);
    setResult(null);
    setPhase({ kind: "idle" });
  };

  const reset = () => {
    if (url) URL.revokeObjectURL(url);
    setFile(null);
    setUrl(null);
    setFrames([]);
    setResult(null);
    setPhase({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  };

  const run = async () => {
    if (!file || !url) return;
    setResult(null);
    setPhase({ kind: "extracting", done: 0 });
    try {
      const ex = await extractFrames(url, FRAME_COUNT, (done) => setPhase({ kind: "extracting", done }));
      if (!ex.frames.length) throw new Error("No frames could be read from this video.");
      setFrames(ex.frames);
      setAspect(ex.aspect);
      setPhase({ kind: "analyzing" });
      const res = await analyzeFn({ data: { fileName: file.name, duration: ex.duration, frames: ex.frames } });
      if (!res.ok) {
        toast.error(res.error);
        setPhase({ kind: "idle" });
        return;
      }
      setResult(res.result);
      setLatency(res.latencyMs);
      setPhase({ kind: "done" });

      const peak = res.result.frames.reduce<(typeof res.result.frames)[number] | undefined>(
        (a, b) => (!a || b.score > a.score ? b : a),
        undefined,
      );
      const peakImage = ex.frames[peak?.index ?? 0]?.image ?? ex.frames[0]?.image;
      const thumb = peakImage ? await makeThumb(peakImage) : "";
      addHistory({
        type: "video",
        title: file.name,
        level: res.result.level,
        score: res.result.score,
        confidence: res.result.confidence,
        summary: res.result.summary,
        indicators: res.result.indicators,
        thumbnail: thumb || undefined,
        meta: {
          Duration: formatTime(ex.duration),
          Size: formatBytes(file.size),
          "Frames analyzed": ex.frames.length,
          "Peak frame": peak ? `${formatTime(peak.time)} (${Math.round(peak.score)})` : "-",
          Latency: `${res.latencyMs} ms`,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Video analysis failed.");
      setPhase({ kind: "idle" });
    }
  };

  const busy = phase.kind === "extracting" || phase.kind === "analyzing";
  const progress =
    phase.kind === "extracting" ? (phase.done / FRAME_COUNT) * 60 : phase.kind === "analyzing" ? 80 : phase.kind === "done" ? 100 : 0;

  if (!file || !url) {
    return (
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed bg-card/60 px-6 py-20 text-center transition-colors",
          dragOver ? "border-primary bg-accent/40" : "hover:border-primary/60",
        )}
      >
        <input ref={inputRef} type="file" accept="video/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
        <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
          <Upload className="size-6" />
        </span>
        <div>
          <h3 className="font-display text-xl font-semibold">Drop a video to analyze</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            MP4, WebM or MOV up to 500 MB. Frames are sampled in your browser, then scanned for face-swap and
            generation artifacts.
          </p>
        </div>
        <span className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium">Choose file</span>
      </label>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <div className="viewfinder relative overflow-hidden rounded-lg border bg-panel shadow-panel">
          <video ref={playerRef} src={url} controls playsInline className="aspect-video w-full bg-panel" />
          {busy && <div className="scanline" />}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileVideo className="size-4 shrink-0 text-primary" />
            <span className="truncate font-medium">{file.name}</span>
            <span className="font-mono text-xs text-muted-foreground">{formatBytes(file.size)}</span>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={reset} disabled={busy}>
              <RotateCcw /> New video
            </Button>
            <Button variant="scan" onClick={run} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {phase.kind === "done" ? "Re-analyze" : "Analyze video"}
            </Button>
          </div>
        </div>

        {busy && (
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <div className="flex justify-between font-mono text-xs text-muted-foreground">
              <span>
                {phase.kind === "extracting"
                  ? `SAMPLING FRAMES ${phase.done}/${FRAME_COUNT}`
                  : "RUNNING FORENSIC MODEL ON SAMPLED FRAMES"}
              </span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        )}

        {frames.length > 0 && (
          <div>
            <div className="label-caps mb-3 text-muted-foreground">Sampled frames</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {frames.map((f, i) => {
                const fr = result?.frames[i];
                const level = fr ? threatLevel(fr.score) : null;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      if (playerRef.current) playerRef.current.currentTime = f.time;
                    }}
                    className="group overflow-hidden rounded-md border bg-card text-left transition-colors hover:border-primary"
                  >
                    <div className="relative bg-panel" style={{ aspectRatio: aspect }}>
                      <img src={f.image} alt={`Frame at ${formatTime(f.time)}`} className="absolute inset-0 h-full w-full" />
                      {fr && <FaceOverlay faces={fr.faces} showLabels={false} />}
                    </div>
                    <div className="flex items-center justify-between px-2 py-1.5 font-mono text-[11px]">
                      <span className="text-muted-foreground">{formatTime(f.time)}</span>
                      <span className={cn("font-semibold", level ? levelText(level) : "text-muted-foreground")}>
                        {fr ? Math.round(fr.score) : "··"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 shadow-panel">
          <ThreatMeter score={result?.score ?? null} label="Manipulation score" />
          {result && (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <StatTile label="Confidence" value={`${Math.round(result.confidence)}%`} />
              <StatTile label="Latency" value={`${(latency / 1000).toFixed(1)} s`} />
            </div>
          )}
          {result && (
            <div className="mt-5">
              <div className="label-caps mb-2 text-muted-foreground">Score across timeline</div>
              <Sparkline values={result.frames.map((f) => f.score)} />
            </div>
          )}
        </div>

        {result ? (
          <div className="rounded-lg border bg-card p-5 shadow-panel">
            <div className="mb-3 flex items-center justify-between">
              <span className="label-caps text-muted-foreground">Verdict</span>
              <LevelBadge level={result.level} />
            </div>
            <p className="mb-4 text-sm">{result.summary}</p>
            <IndicatorList indicators={result.indicators} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Analyze video</span> to sample {FRAME_COUNT} frames across the
            clip and score each one. Click any frame to jump the player to that moment.
          </div>
        )}
      </aside>
    </div>
  );
}
