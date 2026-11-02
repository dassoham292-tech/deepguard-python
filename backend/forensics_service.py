import os
import re
import json
import time
import asyncio
from typing import Any, Dict, List, Optional
import httpx
from dotenv import load_dotenv

load_dotenv()  # <-- Add this right here

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite"
DEEP_MODEL = os.getenv("GEMINI_DEEP_MODEL") or os.getenv("GEMINI_MODEL") or "gemini-3.5-flash-lite"

SHARED_RULES = """
Be calibrated and evidence-driven. Ordinary, natural footage or speech of a real person should score LOW (0-25).
Only raise the score when you see or hear concrete artifacts. Never invent evidence.
"score" is an AI-generated heuristic estimate (0-100), NOT a calibrated probability.
"confidence" (0-100) is how sure you are of your score given the media quality.
"indicators" lists up to 5 short, specific observations (both suspicious and reassuring), each with severity "low" | "medium" | "high".
Respond with JSON only.
"""

FRAME_SYSTEM = f"""You are DeepGuard, a real-time media forensics analyst detecting deepfakes in live video frames (webcam or a shared screen showing a video call).
Inspect each human face for: face-swap blending seams, inconsistent skin texture or over-smoothing, warped or asymmetric features, mismatched lighting/shadows, unnatural eyes or reflections, malformed teeth/ears/hair edges, GAN or diffusion artifacts, and mismatched resolution between face and background.
Detect EVERY visible human face and give a tight bounding box as [ymin, xmin, ymax, xmax] normalized to 0-1000 of the image, plus a per-face manipulation score.
{SHARED_RULES}
JSON shape: {{"score": number, "confidence": number, "summary": string (one sentence), "indicators": [{{"label": string, "severity": string}}], "faces": [{{"box": [ymin, xmin, ymax, xmax], "score": number, "label": string}}]}}
If no face is visible, return faces: [] and a low score with a summary saying no face was found.
"""

VIDEO_SYSTEM = f"""You are DeepGuard, a media forensics analyst. You receive frames sampled in order from one uploaded video, each preceded by its index and timestamp.
Look for deepfake evidence within frames (face-swap seams, texture smoothing, warped features, lighting mismatch, GAN/diffusion artifacts) AND across frames (identity drift, flickering face boundaries, inconsistent accessories, unnatural motion or blinking, lip region instability).
For every frame, return a manipulation score and face bounding boxes as [ymin, xmin, ymax, xmax] normalized 0-1000.
{SHARED_RULES}
JSON shape: {{"score": number, "confidence": number, "summary": string (2 sentences max), "indicators": [{{"label": string, "severity": string}}], "frames": [{{"index": number, "score": number, "faces": [{{"box": [ymin, xmin, ymax, xmax], "score": number, "label": string}}]}}]}}
"""

AUDIO_SYSTEM = f"""You are DeepGuard, an audio forensics analyst detecting AI voice cloning and synthetic speech.
Listen for: unnatural prosody or flat intonation, missing or uniform breaths, metallic or vocoder artifacts, spectral smearing, abrupt splices, inconsistent room tone/reverb, robotic sibilance, unnaturally clean background, and pitch or timbre glitches.
Identify the time ranges (in seconds) that sound most suspicious, if any.
{SHARED_RULES}
JSON shape: {{"score": number, "confidence": number, "summary": string (2 sentences max), "indicators": [{{"label": string, "severity": string}}], "segments": [{{"start": number, "end": number, "score": number, "note": string}}], "transcript": string (first ~40 words heard, or "" if no speech)}}
"""


def parse_loose_json(text: str) -> Dict[str, Any]:
    trimmed = text.strip()
    trimmed = re.sub(r"^```(?:json)?\s*", "", trimmed, flags=re.IGNORECASE)
    trimmed = re.sub(r"```\s*$", "", trimmed)
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        start = trimmed.find("{")
        end = trimmed.rfind("}")
        if start != -1 and end > start:
            return json.loads(trimmed[start : end + 1])
        raise ValueError("Model did not return valid JSON")


def extract_data_url(data_url: str) -> tuple[str, str]:
    match = re.match(r"^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url, re.DOTALL)
    if not match:
        raise ValueError("Invalid image data URL format")
    return match.group(1), match.group(2).strip()


async def run_forensic_model(model: str, system_prompt: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not set")

    clean_model = model.replace("google/", "").replace("models/", "") or "gemini-3.5-flash-lite"
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{clean_model}:generateContent"

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    max_attempts = 3
    async with httpx.AsyncClient(timeout=45.0) as client:
        for attempt in range(max_attempts):
            try:
                response = await client.post(
                    url,
                    headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
                    json=payload,
                )
                if response.status_code in (429, 500, 502, 503):
                    if attempt < max_attempts - 1:
                        await asyncio.sleep(2**attempt)
                        continue
                response.raise_for_status()
                data = response.json()
                candidate_text = data["candidates"][0]["content"]["parts"][0]["text"]
                return parse_loose_json(candidate_text)
            except httpx.HTTPStatusError:
                # Do not retry permanent client errors.
                raise

            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == max_attempts - 1:
                    raise

                await asyncio.sleep(2 ** attempt)
