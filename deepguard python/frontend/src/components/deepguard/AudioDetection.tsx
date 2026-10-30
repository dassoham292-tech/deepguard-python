import { FileAudio, Loader2, Mic, RotateCcw, ScanSearch, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { analyzeAudio } from "@/lib/forensics.functions";
import { threatLevel, type AudioResult } from "@/lib/forensics-types";
import { addHistory } from "@/lib/history";
import { blobToBase64, detectAudioFormat, formatBytes, formatTime, pickRecorderMime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

import { IndicatorList, LevelBadge, StatTile, ThreatMeter, levelBg } from "./threat";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RECORD_SEC = 60;
const BARS = 120;

async function decodePeaks(blob: Blob): Promise<{ peaks: number[]; duration: number } | null> {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const peaks: number[] = [];
    for (let i = 0; i < BARS; i++) {
      let max = 0;
      for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j++) {
        const v = Math.abs(data[j] ?? 0);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const norm = Math.max(...peaks, 0.01);
    void ctx.close();
    return { peaks: peaks.map((p) => p / norm), duration: buf.duration };
  } catch {
    return null;
  }
}

type Clip = { blob: Blob; name: string; url: string; recorded: boolean };

export function AudioDetection() {
  const analyzeFn = analyzeAudio;
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [clip, setClip] = useState<Clip | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AudioResult | null>(null);
  const [latency, setLatency] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip]);
  useEffect(
    () => () => {
      if (recTimer.current) clearInterval(recTimer.current);
      if (recRef.current?.state === "recording") recRef.current.stop();
    },
    [],
  );

  const load = async (blob: Blob, name: string, recorded: boolean) => {
    if (!detectAudioFormat(blob.type, name)) {
      toast.error("Unsupported format. Use MP3, WAV, M4A, OGG, WebM, AAC or FLAC.");
      return;
    }
    if (blob.size > MAX_BYTES) {
      toast.error("Audio files must be 10 MB or smaller.");
      return;
    }
    setClip({ blob, name, url: URL.createObjectURL(blob), recorded });
    const decoded = await decodePeaks(blob);
    setPeaks(decoded?.peaks ?? []);
    setDuration(decoded?.duration ?? 0);
  };

  const startRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone access was blocked.");
      return;
    }
    const mime = pickRecorderMime();
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (recTimer.current) clearInterval(recTimer.current);
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || mime });
      const ext = detectAudioFormat(blob.type) ?? "webm";
      void load(blob, `recording-${new Date().toLocaleTimeString([], { hour12: false }).replace(/:/g, "")}.${ext}`, true);
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
    setRecSec(0);
    const started = Date.now();
    recTimer.current = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setRecSec(s);
      if (s >= MAX_RECORD_SEC && rec.state === "recording") rec.stop();
    }, 250);
  };

  const reset = () => {
    setClip(null);
    setPeaks([]);
    setDuration(0);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const run = async () => {
    if (!clip) return;
    const format = detectAudioFormat(clip.blob.type, clip.name);
    if (!format) return;
    setBusy(true);
    setResult(null);
    try {
      const base64 = await blobToBase64(clip.blob);
      const res = await analyzeFn({ data: { fileName: clip.name, format, base64, duration } });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResult(res.result);
      setLatency(res.latencyMs);
      addHistory({
        type: "audio",
        title: clip.name,
        level: res.result.level,
        score: res.result.score,
        confidence: res.result.confidence,
        summary: res.result.summary,
        indicators: res.result.indicators,
        meta: {
          Source: clip.recorded ? "Microphone recording" : "Uploaded file",
          Duration: duration ? formatTime(duration) : "-",
          Size: formatBytes(clip.blob.size),
          "Suspicious segments": res.result.segments.filter((s) => s.score >= 35).length,
          Latency: `${res.latencyMs} ms`,
          ...(res.result.transcript ? { Transcript: res.result.transcript } : {}),
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Audio analysis failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!clip) {
    return (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void load(f, f.name, false);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed bg-card/60 px-6 py-20 text-center transition-colors",
            dragOver ? "border-primary bg-accent/40" : "hover:border-primary/60",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f, f.name, false);
            }}
          />
          <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-6" />
          </span>
          <div>
            <h3 className="font-display text-xl font-semibold">Drop an audio file</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Voice notes, call recordings or clips up to 10 MB. We listen for cloned-voice and speech-synthesis
              artifacts.
            </p>
          </div>
          <span className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium">Choose file</span>
        </label>

        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-6 text-center shadow-panel">
          <span
            className={cn(
              "grid size-16 place-items-center rounded-full border-2",
              recording ? "border-danger text-danger" : "border-primary/50 text-primary",
            )}
          >
            <Mic className={cn("size-7", recording && "pulse-dot")} />
          </span>
          <div>
            <div className="font-display text-lg font-semibold">Record from mic</div>
            <p className="text-sm text-muted-foreground">Up to {MAX_RECORD_SEC} seconds</p>
          </div>
          {recording ? (
            <Button variant="halt" onClick={() => recRef.current?.stop()}>
              <Square /> Stop · {formatTime(recSec)}
            </Button>
          ) : (
            <Button variant="outline" onClick={startRecording}>
              <Mic /> Start recording
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-4">
        <div className="viewfinder relative overflow-hidden rounded-lg border bg-panel p-6 pb-4 shadow-panel">
          {busy && <div className="scanline" />}
          <div className="relative flex h-40 items-center gap-[2px]">
            {/* suspicious segments */}
            {result && duration > 0 &&
              result.segments.map((s, i) => (
                <div
                  key={i}
                  title={s.note}
                  className={cn("absolute inset-y-0 rounded-sm opacity-25", levelBg(threatLevel(s.score)))}
                  style={{ left: `${(s.start / duration) * 100}%`, width: `${Math.max(0.8, ((s.end - s.start) / duration) * 100)}%` }}
                />
              ))}
            {peaks.length > 0 ? (
              peaks.map((p, i) => (
                <div
                  key={i}
                  className="relative flex-1 rounded-full bg-primary/80"
                  style={{ height: `${Math.max(3, p * 100)}%` }}
                />
              ))
            ) : (
              <div className="w-full text-center font-mono text-xs text-panel-muted">waveform preview unavailable</div>
            )}
          </div>
          <audio src={clip.url} controls className="mt-4 w-full" />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <FileAudio className="size-4 shrink-0 text-primary" />
            <span className="truncate font-medium">{clip.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {duration ? formatTime(duration) : "-"} · {formatBytes(clip.blob.size)}
            </span>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={reset} disabled={busy}>
              <RotateCcw /> New clip
            </Button>
            <Button variant="scan" onClick={run} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {result ? "Re-analyze" : "Analyze audio"}
            </Button>
          </div>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 shadow-panel">
          <ThreatMeter score={result?.score ?? null} label="Voice clone probability" />
          {result && (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <StatTile label="Confidence" value={`${Math.round(result.confidence)}%`} />
              <StatTile label="Latency" value={`${(latency / 1000).toFixed(1)} s`} />
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
            {result.transcript && (
              <div className="mb-4 rounded-md border bg-muted/40 p-3">
                <div className="label-caps mb-1 text-[10px] text-muted-foreground">Speech detected</div>
                <p className="font-mono text-xs italic text-foreground/80">"{result.transcript}"</p>
              </div>
            )}
            <IndicatorList indicators={result.indicators} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
            Press <span className="font-medium text-foreground">Analyze audio</span> to scan this clip for synthetic speech,
            vocoder artifacts, and voice cloning.
          </div>
        )}
      </aside>
    </div>
  );
}
