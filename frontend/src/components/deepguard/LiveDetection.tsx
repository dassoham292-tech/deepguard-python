import { Activity, Camera, Gauge, Mic, MonitorUp, Radio, Square, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { analyzeAudio, analyzeFrame } from "@/lib/forensics.functions";
import {
  createInflightGate,
  threatLevel,
  type FaceBox,
  type FrameResult,
} from "@/lib/forensics-types";
import { addHistory } from "@/lib/history";
import { blobToBase64, captureFrame, detectAudioFormat, makeThumb, pickRecorderMime } from "@/lib/media-utils";
import { cn } from "@/lib/utils";

import {
  FaceOverlay,
  IndicatorList,
  LevelIcon,
  Sparkline,
  StatTile,
  ThreatMeter,
  levelText,
} from "./threat";

type Source = "webcam" | "screen";

type LogEvent = { t: number; kind: "visual" | "voice" | "system"; score?: number; text: string };

const INGEST_MS = 500; // frames are "ingested" at 2 fps
const VOICE_SEGMENT_MS = 5000;
const RATE_OPTIONS = [
  { value: "1500", label: "Fast" },
  { value: "3000", label: "Balanced" },
  { value: "6000", label: "Eco" },
];

export function LiveDetection() {
  const analyzeFrameFn = analyzeFrame;
  const analyzeAudioFn = analyzeAudio;

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const frameGate = useRef(createInflightGate());
  const voiceGate = useRef(createInflightGate());
  const lastSentRef = useRef(0);
  const pauseUntilRef = useRef(0);
  const errorStreakRef = useRef(0);
  const minIntervalRef = useRef(3000);
  const voiceEnabledRef = useRef(true);

  // session accumulators
  const sessionRef = useRef({
    start: 0,
    ingested: 0,
    analyzed: 0,
    latencies: [] as number[],
    scores: [] as number[],
    voiceScores: [] as number[],
    peak: null as null | { score: number; frame: string; result: FrameResult },
  });

  const [source, setSource] = useState<Source | null>(null);
  const [running, setRunning] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const [rate, setRate] = useState("3000");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [faces, setFaces] = useState<FaceBox[]>([]);
  const [latest, setLatest] = useState<FrameResult | null>(null);
  const [visualEma, setVisualEma] = useState<number | null>(null);
  const [voiceEma, setVoiceEma] = useState<number | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [stats, setStats] = useState({ ingested: 0, analyzed: 0, dropped: 0, latency: 0, busy: false });
  const [log, setLog] = useState<LogEvent[]>([]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    minIntervalRef.current = Number(rate);
  }, [rate]);
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
  }, [voiceEnabled]);

  const pushLog = useCallback((e: Omit<LogEvent, "t">) => {
    setLog((l) => [{ ...e, t: Date.now() }, ...l].slice(0, 10));
  }, []);

  const handleFailure = useCallback(
    (status: number, error: string) => {
      if (status === 402 || status === 403) {
        toast.error(error);
        stopRef.current?.();
        return;
      }
      if (status === 429) {
        pauseUntilRef.current = Date.now() + 10_000;
        pushLog({ kind: "system", text: "Rate limited — pausing analysis for 10s" });
        return;
      }
      errorStreakRef.current++;
      pushLog({ kind: "system", text: error });
      if (errorStreakRef.current >= 3) {
        toast.error("Analysis keeps failing. Session stopped.", { description: error });
        stopRef.current?.();
      }
    },
    [pushLog],
  );

  const tick = useCallback(async () => {
    const video = videoRef.current;
    if (!runningRef.current || !video) return;
    const s = sessionRef.current;
    s.ingested++;
    const now = Date.now();
    setElapsed(Math.floor((now - s.start) / 1000));

    const throttled = now - lastSentRef.current < minIntervalRef.current || now < pauseUntilRef.current;
    if (throttled) {
      setStats((st) => ({ ...st, ingested: s.ingested }));
      return;
    }
    // Backpressure: if an inference is still running, drop this frame instead of queueing.
    if (!frameGate.current.tryAcquire()) {
      const g = frameGate.current.stats();
      setStats((st) => ({ ...st, ingested: s.ingested, dropped: g.dropped, busy: true }));
      return;
    }
    lastSentRef.current = now;
    const frame = captureFrame(video, 640, 0.7);
    if (!frame) {
      frameGate.current.release();
      return;
    }
    setStats((st) => ({ ...st, ingested: s.ingested, busy: true }));
    try {
      const res = await analyzeFrameFn({ data: { image: frame, source: source ?? "webcam" } });
      if (!runningRef.current) return;
      if (!res.ok) {
        handleFailure(res.status, res.error);
        return;
      }
      errorStreakRef.current = 0;
      const r = res.result;
      s.analyzed++;
      s.latencies.push(res.latencyMs);
      s.scores.push(r.score);
      if (!s.peak || r.score > s.peak.score) s.peak = { score: r.score, frame, result: r };
      setLatest(r);
      setFaces(r.faces);
      setVisualEma((prev) => (prev === null ? r.score : prev * 0.5 + r.score * 0.5));
      setSeries((v) => [...v, r.score].slice(-40));
      setStats((st) => ({
        ...st,
        analyzed: s.analyzed,
        latency: res.latencyMs,
        dropped: frameGate.current.stats().dropped,
      }));
      if (r.level !== "authentic" || s.analyzed === 1) {
        pushLog({
          kind: "visual",
          score: r.score,
          text: r.faces.length ? r.summary : "No face in frame",
        });
      }
    } catch (e) {
      handleFailure(500, e instanceof Error ? e.message : "Network error");
    } finally {
      frameGate.current.release();
      setStats((st) => ({ ...st, busy: false }));
    }
  }, [analyzeFrameFn, handleFailure, pushLog, source]);

  const tickRefFn = useRef(tick);
  useEffect(() => {
    tickRefFn.current = tick;
  }, [tick]);

  // ---- voice clone pipeline: complete 5s segments, one in flight at a time ----
  const startVoiceSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!runningRef.current || !stream) return;
    const tracks = stream.getAudioTracks().filter((t) => t.readyState === "live");
    if (!tracks.length) return;
    const mime = pickRecorderMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime } : undefined);
    } catch {
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      if (runningRef.current) startVoiceSegment();
      if (!voiceEnabledRef.current || !chunks.length) return;
      if (Date.now() < pauseUntilRef.current) return;
      if (!voiceGate.current.tryAcquire()) return; // drop segment under backpressure
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || mime });
        if (blob.size < 2000) return;
        const format = detectAudioFormat(blob.type) ?? "webm";
        const base64 = await blobToBase64(blob);
        const res = await analyzeAudioFn({
          data: { fileName: "live-mic", format, base64, duration: VOICE_SEGMENT_MS / 1000, live: true },
        });
        if (!runningRef.current) return;
        if (!res.ok) {
          handleFailure(res.status, res.error);
          return;
        }
        const r = res.result;
        // Silence yields no transcript; don't let it move the meter.
        if (!r.transcript.trim()) return;
        sessionRef.current.voiceScores.push(r.score);
        setVoiceEma((prev) => (prev === null ? r.score : prev * 0.5 + r.score * 0.5));
        if (r.level !== "authentic") pushLog({ kind: "voice", score: r.score, text: r.summary });
      } catch (e) {
        handleFailure(500, e instanceof Error ? e.message : "Network error");
      } finally {
        voiceGate.current.release();
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    voiceTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, VOICE_SEGMENT_MS);
  }, [analyzeAudioFn, handleFailure, pushLog]);

  const stop = useCallback(async () => {
    if (!runningRef.current && !streamRef.current) return;
    runningRef.current = false;
    if (tickRef.current) clearInterval(tickRef.current);
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    setStats((st) => ({ ...st, busy: false }));

    const s = sessionRef.current;
    if (s.analyzed > 0 && s.peak) {
      const avgLatency = Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length);
      const avgScore = Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length);
      const voicePeak = s.voiceScores.length ? Math.max(...s.voiceScores) : null;
      const score = Math.max(s.peak.score, voicePeak ?? 0);
      const thumb = await makeThumb(s.peak.frame);
      addHistory({
        type: "live",
        title: source === "screen" ? "Screen share session" : "Webcam session",
        level: threatLevel(score),
        score,
        confidence: s.peak.result.confidence,
        summary: s.peak.result.summary,
        indicators: s.peak.result.indicators,
        thumbnail: thumb || undefined,
        meta: {
          Source: source === "screen" ? "Screen share" : "Webcam",
          Duration: `${Math.round((Date.now() - s.start) / 1000)}s`,
          "Frames analyzed": s.analyzed,
          "Frames dropped": frameGate.current.stats().dropped,
          "Avg latency": `${avgLatency} ms`,
          "Avg visual score": avgScore,
          ...(voicePeak !== null ? { "Peak voice score": voicePeak } : {}),
        },
      });
      toast.success("Session saved to history");
    }
  }, [source]);

  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    stopRef.current = () => void stop();
  }, [stop]);

  useEffect(() => () => stopRef.current?.(), []);

  const start = async (src: Source) => {
    if (runningRef.current) await stop();
    let stream: MediaStream;
    try {
      if (src === "screen") {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: true });
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        }
      }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      toast.error(
        name === "NotAllowedError"
          ? src === "screen"
            ? "Screen sharing was cancelled or blocked."
            : "Camera access was blocked. Allow it in your browser to start."
          : src === "screen"
            ? "Screen sharing isn't available in this browser."
            : "No camera found.",
      );
      return;
    }

    streamRef.current = stream;
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopRef.current?.());
    setHasAudio(stream.getAudioTracks().length > 0);

    const video = videoRef.current!;
    video.srcObject = stream;
    video.onloadedmetadata = () => {
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
    };
    await video.play().catch(() => {});

    // reset session
    frameGate.current.reset();
    voiceGate.current.reset();
    sessionRef.current = { start: Date.now(), ingested: 0, analyzed: 0, latencies: [], scores: [], voiceScores: [], peak: null };
    lastSentRef.current = 0;
    pauseUntilRef.current = 0;
    errorStreakRef.current = 0;
    setFaces([]);
    setLatest(null);
    setVisualEma(null);
    setVoiceEma(null);
    setSeries([]);
    setLog([]);
    setElapsed(0);
    setStats({ ingested: 0, analyzed: 0, dropped: 0, latency: 0, busy: false });
    setSource(src);
    setRunning(true);
    runningRef.current = true;
    pushLog({ kind: "system", text: src === "screen" ? "Screen share stream opened" : "Webcam stream opened" });

    tickRef.current = setInterval(() => void tickRefFn.current(), INGEST_MS);
    startVoiceSegment();
  };

  const combined =
    visualEma === null && voiceEma === null ? null : Math.max(visualEma ?? 0, voiceEma ?? 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Viewfinder */}
      <section className="space-y-4">
        <div
          className="viewfinder relative w-full overflow-hidden rounded-lg border bg-panel shadow-panel"
          style={{ aspectRatio: running ? aspect : 16 / 9 }}
        >
          <video ref={videoRef} muted playsInline className={cn("absolute inset-0 h-full w-full", !running && "hidden")} />
          {running && <div className="scanline" />}
          {running && <FaceOverlay faces={faces} />}

          {!running && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-sm space-y-4">
                <div className="mx-auto grid size-14 place-items-center rounded-full border border-primary/40 text-primary">
                  <Radio className="size-6" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold text-panel-foreground">
                    No live signal
                  </h3>
                  <p className="mt-1 text-sm text-panel-muted">
                    Open your camera, or share a screen with a video call to scan every participant's face.
                  </p>
                </div>
              </div>
            </div>
          )}

          {running && (
            <div className="absolute left-3 top-3 z-[5] flex items-center gap-2 rounded-sm bg-panel/80 px-2 py-1 font-mono text-[11px] text-panel-foreground">
              <span className="pulse-dot size-2 rounded-full bg-danger" />
              LIVE · {source === "screen" ? "SCREEN" : "CAM"} · {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, "0")}
            </div>
          )}
          {running && (
            <div className="absolute right-3 top-3 z-[5] rounded-sm bg-panel/80 px-2 py-1 font-mono text-[11px] text-panel-foreground">
              {stats.busy ? "INFERENCE…" : "IDLE"} · {faces.length} FACE{faces.length === 1 ? "" : "S"}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!running ? (
            <>
              <Button variant="scan" size="lg" onClick={() => start("webcam")}>
                <Camera /> Start webcam
              </Button>
              <Button variant="outline" size="lg" onClick={() => start("screen")}>
                <MonitorUp /> Share screen
              </Button>
            </>
          ) : (
            <>
              <Button variant="halt" size="lg" onClick={() => void stop()}>
                <Square /> Stop session
              </Button>
              <Button variant="outline" size="lg" onClick={() => start(source === "screen" ? "webcam" : "screen")}>
                {source === "screen" ? <Camera /> : <MonitorUp />}
                Switch to {source === "screen" ? "webcam" : "screen share"}
              </Button>
            </>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="label-caps text-muted-foreground">Scan rate</span>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={rate}
                onValueChange={(v) => v && setRate(v)}
              >
                {RATE_OPTIONS.map((o) => (
                  <ToggleGroupItem key={o.value} value={o.value} className="font-mono text-xs">
                    {o.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="voice-scan" checked={voiceEnabled} onCheckedChange={setVoiceEnabled} />
              <Label htmlFor="voice-scan" className="text-sm">
                Voice-clone scan
              </Label>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Ingested" value={stats.ingested} hint="frames @ 2 fps" />
          <StatTile label="Analyzed" value={stats.analyzed} hint="sent to AI" />
          <StatTile label="Dropped" value={stats.dropped} hint="backpressure" />
          <StatTile label="Latency" value={stats.latency ? `${stats.latency} ms` : "--"} hint="last inference" />
        </div>
      </section>

      {/* Telemetry */}
      <aside className="space-y-4">
        <div className="rounded-lg border bg-card p-5 shadow-panel">
          <ThreatMeter score={combined} active={running} />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-md border px-3 py-2">
              <div className="label-caps flex items-center gap-1.5 text-muted-foreground">
                <Activity className="size-3" /> Visual
              </div>
              <div className={cn("font-mono text-xl font-semibold", visualEma !== null && levelText(threatLevel(visualEma)))}>
                {visualEma === null ? "--" : Math.round(visualEma)}
              </div>
            </div>
            <div className="rounded-md border px-3 py-2">
              <div className="label-caps flex items-center gap-1.5 text-muted-foreground">
                <Mic className="size-3" /> Voice
              </div>
              <div className={cn("font-mono text-xl font-semibold", voiceEma !== null && levelText(threatLevel(voiceEma)))}>
                {!voiceEnabled ? "off" : running && !hasAudio ? "n/a" : voiceEma === null ? "--" : Math.round(voiceEma)}
              </div>
            </div>
          </div>
          <div className="mt-5">
            <div className="label-caps mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Gauge className="size-3" /> Visual score timeline
            </div>
            <Sparkline values={series} />
          </div>
        </div>

        {latest && (
          <div className="rounded-lg border bg-card p-5 shadow-panel">
            <div className="mb-3 flex items-center gap-2">
              <LevelIcon level={latest.level} className="size-4" />
              <span className="label-caps text-muted-foreground">Last frame verdict</span>
            </div>
            <p className="mb-4 text-sm">{latest.summary || "No face detected in frame."}</p>
            <IndicatorList indicators={latest.indicators} />
          </div>
        )}

        <div className="rounded-lg border bg-card p-5 shadow-panel">
          <div className="label-caps mb-3 flex items-center gap-1.5 text-muted-foreground">
            <Timer className="size-3" /> Event log
          </div>
          {log.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">No events yet.</p>
          ) : (
            <ul className="space-y-2">
              {log.map((e, i) => (
                <li key={i} className="font-mono text-xs leading-relaxed">
                  <span className="text-muted-foreground">
                    {new Date(e.t).toLocaleTimeString([], { hour12: false })}
                  </span>{" "}
                  <span className={cn("uppercase", e.score !== undefined ? levelText(threatLevel(e.score)) : "text-primary")}>
                    [{e.kind}
                    {e.score !== undefined ? ` ${Math.round(e.score)}` : ""}]
                  </span>{" "}
                  <span className="text-foreground/80">{e.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
