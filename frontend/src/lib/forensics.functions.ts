
import type {
  AnalysisResponse,
  AudioResult,
  FrameResult,
  VideoResult,
} from "./forensics-types";

const configuredBase = import.meta.env["VITE_PYTHON_API_URL"]?.trim();

const API_BASE = (
  configuredBase ||
  (import.meta.env.DEV ? "http://localhost:8000" : "")
).replace(/\/+$/, "");

export type AnalyzeFrameInput = {
  image: string;
  source: "webcam" | "screen";
};

export type AnalyzeVideoInput = {
  fileName: string;
  duration: number;
  frames: Array<{ time: number; image: string }>;
};

export type AnalyzeAudioInput = {
  fileName: string;
  format: "wav" | "mp3" | "webm" | "m4a" | "ogg" | "aac" | "flac";
  base64: string;
  duration: number;
  live?: boolean;
};

function unwrap<T>(input: T | { data: T }): T {
  if (input && typeof input === "object" && "data" in input) {
    return (input as { data: T }).data;
  }

  return input as T;
}

async function postAnalysis<T>(
  path: string,
  body: unknown,
): Promise<AnalysisResponse<T>> {

  if (!API_BASE) {
    return {
      ok: false,
      status: 503,
      error:
        "Python backend URL is not configured. Set VITE_PYTHON_API_URL.",
    };
  }

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const payload = await response.json().catch(() => ({})) as {
      ok?: boolean;
      status?: number;
      error?: string;
      detail?: string;
      result?: T;
      latencyMs?: number;
    };

    if (
      !response.ok ||
      payload.ok === false ||
      !payload.result
    ) {
      return {
        ok: false,
        status: response.status || payload.status || 502,
        error:
          payload.error ||
          payload.detail ||
          `Backend returned HTTP ${response.status}`,
      };
    }

    return payload as AnalysisResponse<T>;

  } catch (error) {
    return {
      ok: false,
      status: 503,
      error:
        error instanceof Error
          ? error.message
          : "Could not connect to the Python backend.",
    };
  }
}

export function analyzeFrame(
  rawInput: AnalyzeFrameInput | { data: AnalyzeFrameInput },
): Promise<AnalysisResponse<FrameResult>> {
  return postAnalysis(
    "/api/analyze-frame",
    unwrap(rawInput),
  );
}

export function analyzeVideoFrames(
  rawInput: AnalyzeVideoInput | { data: AnalyzeVideoInput },
): Promise<AnalysisResponse<VideoResult>> {
  return postAnalysis(
    "/api/analyze-video",
    unwrap(rawInput),
  );
}

export function analyzeAudio(
  rawInput: AnalyzeAudioInput | { data: AnalyzeAudioInput },
): Promise<AnalysisResponse<AudioResult>> {
  return postAnalysis(
    "/api/analyze-audio",
    unwrap(rawInput),
  );
}
