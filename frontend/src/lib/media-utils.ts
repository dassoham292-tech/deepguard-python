// Browser-only media helpers (canvas capture, base64, formats).

export function captureFrame(
  video: HTMLVideoElement,
  maxWidth = 640,
  quality = 0.72,
): string | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxWidth / w);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export type AudioFormat = "wav" | "mp3" | "webm" | "m4a" | "ogg" | "aac" | "flac";

export function detectAudioFormat(mime: string, name = ""): AudioFormat | null {
  const m = mime.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (m.includes("wav") || ext === "wav") return "wav";
  if (m.includes("mpeg") || m.includes("mp3") || ext === "mp3") return "mp3";
  if (m.includes("webm") || ext === "webm") return "webm";
  if (m.includes("mp4") || m.includes("m4a") || ext === "m4a" || ext === "mp4") return "m4a";
  if (m.includes("ogg") || m.includes("opus") || ext === "ogg" || ext === "opus") return "ogg";
  if (m.includes("aac") || ext === "aac") return "aac";
  if (m.includes("flac") || ext === "flac") return "flac";
  return null;
}

export function pickRecorderMime(): string {
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  for (const o of options) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(o)) return o;
  }
  return "";
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Downscale a data URL to a small thumbnail for history. */
export function makeThumb(dataUrl: string, maxWidth = 200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => resolve("");
    img.src = dataUrl;
  });
}
