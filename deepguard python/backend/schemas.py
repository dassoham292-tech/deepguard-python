
from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field, ConfigDict, model_validator


# ============================================================
# ENUMS / TYPES
# ============================================================

ThreatLevel = Literal[
    "authentic",
    "suspicious",
    "manipulated"
]

SeverityLevel = Literal[
    "low",
    "medium",
    "high"
]


# ============================================================
# THREAT LEVEL CALCULATION
# ============================================================

def calculate_threat_level(score: float) -> ThreatLevel:
    """
    Convert a heuristic threat score into a threat category.

    Note:
    This is a threshold-based classification, not a
    statistically validated probability.
    """

    if score >= 65:
        return "manipulated"

    if score >= 35:
        return "suspicious"

    return "authentic"


# ============================================================
# COMMON MODELS
# ============================================================

class Indicator(BaseModel):
    model_config = ConfigDict(extra="ignore")

    label: str = Field(
        min_length=1,
        max_length=240
    )

    severity: SeverityLevel = "low"


class FaceBox(BaseModel):
    """
    Face bounding box coordinates.

    Coordinate format:
    [ymin, xmin, ymax, xmax]

    Coordinates are normalized to the range 0-1000.
    """

    model_config = ConfigDict(extra="ignore")

    box: Tuple[int, int, int, int]

    score: float = Field(
        ge=0,
        le=100
    )

    label: str = Field(
        default="face",
        max_length=80
    )

    @model_validator(mode="after")
    def validate_box_coordinates(self):
        ymin, xmin, ymax, xmax = self.box

        if not all(0 <= value <= 1000 for value in self.box):
            raise ValueError(
                "Face coordinates must be between 0 and 1000."
            )

        if ymin >= ymax or xmin >= xmax:
            raise ValueError(
                "Invalid face bounding box coordinates."
            )

        return self


# ============================================================
# FRAME ANALYSIS
# ============================================================

class FrameResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level: ThreatLevel

    score: float = Field(
        ge=0,
        le=100
    )

    confidence: float = Field(
        ge=0,
        le=100,
        default=50.0
    )

    summary: str = Field(
        min_length=1,
        max_length=2000
    )

    indicators: List[Indicator] = Field(
        default_factory=list
    )

    faces: List[FaceBox] = Field(
        default_factory=list,
        max_length=50
    )


# ============================================================
# VIDEO ANALYSIS
# ============================================================

class VideoFrameScore(BaseModel):
    model_config = ConfigDict(extra="ignore")

    index: int = Field(
        ge=0
    )

    time: float = Field(
        ge=0
    )

    score: float = Field(
        ge=0,
        le=100
    )

    faces: List[FaceBox] = Field(
        default_factory=list,
        max_length=50
    )


class VideoResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level: ThreatLevel

    score: float = Field(
        ge=0,
        le=100
    )

    confidence: float = Field(
        ge=0,
        le=100
    )

    summary: str = Field(
        min_length=1,
        max_length=2000
    )

    indicators: List[Indicator] = Field(
        default_factory=list
    )

    frames: List[VideoFrameScore] = Field(
        default_factory=list,
        max_length=12
    )


# ============================================================
# AUDIO ANALYSIS
# ============================================================

class AudioSegment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    start: float = Field(
        ge=0
    )

    end: float = Field(
        ge=0
    )

    score: float = Field(
        ge=0,
        le=100
    )

    note: str = Field(
        default="",
        max_length=500
    )

    @model_validator(mode="after")
    def validate_segment_time(self):
        if self.end < self.start:
            raise ValueError(
                "Audio segment end must be after its start."
            )

        return self


class AudioResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    level: ThreatLevel

    score: float = Field(
        ge=0,
        le=100
    )

    confidence: float = Field(
        ge=0,
        le=100
    )

    summary: str = Field(
        min_length=1,
        max_length=2000
    )

    indicators: List[Indicator] = Field(
        default_factory=list
    )

    segments: List[AudioSegment] = Field(
        default_factory=list,
        max_length=500
    )

    transcript: str = Field(
        default="",
        max_length=20000
    )


# ============================================================
# API REQUEST MODELS
# ============================================================

class AnalyzeFrameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    image: str = Field(
        min_length=32,
        max_length=8_000_000
    )

    source: Literal[
        "webcam",
        "screen"
    ] = "webcam"


class SampledFrame(BaseModel):
    model_config = ConfigDict(extra="forbid")

    time: float = Field(
        ge=0,
        le=3600
    )

    image: str = Field(
        min_length=32,
        max_length=4_000_000
    )


class AnalyzeVideoRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fileName: str = Field(
        min_length=1,
        max_length=255
    )

    duration: float = Field(
        gt=0,
        le=3600
    )

    frames: List[SampledFrame] = Field(
        min_length=1,
        max_length=12
    )

    @model_validator(mode="after")
    def validate_frame_timestamps(self):
        for frame in self.frames:
            if frame.time > self.duration:
                raise ValueError(
                    "A sampled frame timestamp exceeds video duration."
                )

        return self


class AnalyzeAudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fileName: str = Field(
        min_length=1,
        max_length=255
    )

    format: Literal[
        "wav",
        "mp3",
        "webm",
        "m4a",
        "ogg",
        "aac",
        "flac"
    ]

    base64: str = Field(
        min_length=32,
        max_length=20_000_000
    )

    duration: float = Field(
        gt=0,
        le=3600
    )

    live: Optional[bool] = False
