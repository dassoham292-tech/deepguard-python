import os
import time
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from schemas import (
    AnalyzeFrameRequest,
    AnalyzeVideoRequest,
    AnalyzeAudioRequest,
    FrameResult,
    VideoResult,
    AudioResult,
    calculate_threat_level,
    Indicator,
    FaceBox,
    VideoFrameScore,
    AudioSegment,
)
from forensics_service import (
    LIVE_MODEL,
    DEEP_MODEL,
    FRAME_SYSTEM,
    VIDEO_SYSTEM,
    AUDIO_SYSTEM,
    extract_data_url,
    run_forensic_model,
)

load_dotenv()

app = FastAPI(title="DeepGuard Forensics Python Node", version="1.0.0")

_default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080,http://localhost:3000,http://127.0.0.1:3000"

ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


AUDIO_MIME_TYPES = {
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
    "webm": "audio/webm",
    "m4a": "audio/mp4",
    "ogg": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
}

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "DeepGuard Python Engine"}


# --- 1. Frame Analysis (Webcam & Screen Share) ---
@app.post("/api/analyze-frame", response_model=Dict[str, Any])
async def analyze_frame(req: AnalyzeFrameRequest):
    start = time.time()
    try:
        mime_type, base64_data = extract_data_url(req.image)
        prompt_text = (
            "Live frame from a shared screen (likely a video call). Analyze every participant face."
            if req.source == "screen"
            else "Live webcam frame. Analyze the face(s)."
        )
        parts = [
            {"text": prompt_text},
            {"inlineData": {"mimeType": mime_type, "data": base64_data}},
        ]
        raw = await run_forensic_model(LIVE_MODEL, FRAME_SYSTEM, parts)

        score = float(max(0, min(100, raw.get("score", 0))))
        faces = [
            FaceBox(
                box=(f["box"][0], f["box"][1], f["box"][2], f["box"][3]),
                score=float(f.get("score", score)),
                label=str(f.get("label", "face")),
            )
            for f in raw.get("faces", [])
            if isinstance(f.get("box"), (list, tuple)) and len(f["box"]) == 4
        ]
        indicators = [
            Indicator(label=i.get("label", ""), severity=i.get("severity", "low"))
            for i in raw.get("indicators", [])
        ]

        result = FrameResult(
            level=calculate_threat_level(score),
            score=score,
            confidence=float(max(0, min(100, raw.get("confidence", 50)))),
            summary=str(raw.get("summary", "")),
            indicators=indicators,
            faces=faces,
        )
        return {"ok": True, "result": result.model_dump(), "latencyMs": int((time.time() - start) * 1000)}
    except Exception as e:
        import logging
        logging.exception("DeepGuard forensic analysis failed")

        raise HTTPException(
            status_code=502,
            detail="Forensic analysis failed. Check backend logs and model configuration."
        ) from e


# --- 2. Video Analysis (Sampled Frames) ---
@app.post("/api/analyze-video", response_model=Dict[str, Any])
async def analyze_video(req: AnalyzeVideoRequest):
    start = time.time()
    try:
        parts = [
            {"text": f'Video "{req.fileName}", duration {req.duration:.1f}s, {len(req.frames)} sampled frames follow.'}
        ]
        for idx, f in enumerate(req.frames):
            mime_type, base64_data = extract_data_url(f.image)
            parts.append({"text": f"Frame index {idx} at t={f.time:.2f}s:"})
            parts.append({"inlineData": {"mimeType": mime_type, "data": base64_data}})

        raw = await run_forensic_model(DEEP_MODEL, VIDEO_SYSTEM, parts)
        score = float(max(0, min(100, raw.get("score", 0))))

        raw_frames_map = {f.get("index"): f for f in raw.get("frames", [])}
        frame_scores = []
        for idx, f in enumerate(req.frames):
            match = raw_frames_map.get(idx, {})
            f_score = float(match.get("score", score))
            f_faces = [
                FaceBox(
                    box=(fb["box"][0], fb["box"][1], fb["box"][2], fb["box"][3]),
                    score=float(fb.get("score", f_score)),
                    label=str(fb.get("label", "face")),
                )
                for fb in match.get("faces", [])
                if isinstance(fb.get("box"), (list, tuple)) and len(fb["box"]) == 4
            ]
            frame_scores.append(VideoFrameScore(index=idx, time=f.time, score=f_score, faces=f_faces))

        indicators = [
            Indicator(label=i.get("label", ""), severity=i.get("severity", "low"))
            for i in raw.get("indicators", [])
        ]

        result = VideoResult(
            level=calculate_threat_level(score),
            score=score,
            confidence=float(max(0, min(100, raw.get("confidence", 50)))),
            summary=str(raw.get("summary", "")),
            indicators=indicators,
            frames=frame_scores,
        )
        return {"ok": True, "result": result.model_dump(), "latencyMs": int((time.time() - start) * 1000)}
    except Exception as e:
        import logging
        logging.exception("DeepGuard forensic analysis failed")

        raise HTTPException(
            status_code=502,
            detail="Forensic analysis failed. Check backend logs and model configuration."
        ) from e


# --- 3. Audio Analysis ---
@app.post("/api/analyze-audio", response_model=Dict[str, Any])
async def analyze_audio(req: AnalyzeAudioRequest):
    start = time.time()
    try:
        model = LIVE_MODEL if req.live else DEEP_MODEL
        prompt_text = (
            f"Live microphone segment (~{req.duration:.1f}s). Check for a cloned or synthetic voice."
            if req.live
            else f'Audio file "{req.fileName}", duration {req.duration:.1f}s.'
        )
        mime_type = AUDIO_MIME_TYPES.get(req.format)
        parts = [
            {"text": prompt_text},
            {"inlineData": {"mimeType": mime_type, "data": req.base64.strip()}},
        ]
        raw = await run_forensic_model(model, AUDIO_SYSTEM, parts)
        score = float(max(0, min(100, raw.get("score", 0))))

        indicators = [
            Indicator(label=i.get("label", ""), severity=i.get("severity", "low"))
            for i in raw.get("indicators", [])
        ]
        segments = [
            AudioSegment(
                start=float(s.get("start", 0)),
                end=float(s.get("end", req.duration)),
                score=float(s.get("score", score)),
                note=str(s.get("note", "")),
            )
            for s in raw.get("segments", [])
        ]

        result = AudioResult(
            level=calculate_threat_level(score),
            score=score,
            confidence=float(max(0, min(100, raw.get("confidence", 50)))),
            summary=str(raw.get("summary", "")),
            indicators=indicators,
            segments=segments,
            transcript=str(raw.get("transcript", "")),
        )
        return {"ok": True, "result": result.model_dump(), "latencyMs": int((time.time() - start) * 1000)}
    except Exception as e:
        import logging
        logging.exception("DeepGuard forensic analysis failed")

        raise HTTPException(
            status_code=502,
            detail="Forensic analysis failed. Check backend logs and model configuration."
        ) from e

