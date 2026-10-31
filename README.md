# DeepGuard

DeepGuard is a full-stack media forensics application for detecting AI-manipulated faces, video content, and voice clones. The project combines a React + TypeScript frontend with a Python FastAPI backend that calls Google Gemini models to analyze webcam frames, uploaded videos, and audio clips.

## Overview

This repository contains two main parts:

- `frontend/`: Vite + React + TypeScript dashboard for live and file-based analysis
- `backend/`: FastAPI service that handles media analysis and integrates with Gemini models

The app supports:

- Live webcam or screen-share face analysis
- Uploaded video analysis with per-frame scoring
- Uploaded audio and microphone analysis for synthetic voice detection
- Threat scoring, indicators, and summary output for each analysis

## Architecture

```text
deepguard-python/
├── backend/
│   ├── main.py                 # FastAPI app and analysis endpoints
│   ├── forensics_service.py    # Gemini API integration and prompt orchestration
│   ├── schemas.py              # Request/response models
│   └── requirements.txt        # Python dependencies
├── frontend/
│   ├── src/                   # React application source
│   ├── package.json           # Frontend scripts and dependencies
│   ├── vite.config.ts         # Vite configuration
│   └── README.md              # Frontend-specific notes
├── README.md                  # Project overview and setup
└── .gitignore
```

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Tailwind CSS
- TanStack Router
- shadcn/ui inspired component system

### Backend

- Python 3
- FastAPI
- Pydantic
- Python-dotenv
- Google Gemini API via HTTP

## Features

### Live detection

- Analyzes webcam or shared-screen frames in real time
- Detects suspicious face artifacts and manipulation signals
- Returns a risk score, confidence, and observed indicators

### Video detection

- Accepts uploaded video files
- Samples frames over time
- Identifies suspicious frame patterns and global manipulation trends

### Audio detection

- Analyzes recorded audio or live microphone segments
- Detects cloned or synthetic voice signatures
- Highlights suspicious time sections and transcript metadata

## Environment Setup

Create a `.env` file in the `backend/` directory with your Google Gemini API key:

```env
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-3.6-flash
GEMINI_LIVE_MODEL=gemini-3.6-flash
GEMINI_DEEP_MODEL=gemini-3.6-flash
```

You can also configure frontend origins if needed:

```env
FRONTEND_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Running the Project

### 1) Start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at:

- `http://localhost:8000/health`
- `http://localhost:8000/docs` (FastAPI Swagger UI)

### 2) Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Then open the UI in your browser at:

- `http://localhost:5173`

## API Endpoints

The backend exposes the following main endpoints:

- `GET /health` — service health check
- `POST /api/analyze-frame` — analyze a still image/frame
- `POST /api/analyze-video` — analyze a video sample with multiple frames
- `POST /api/analyze-audio` — analyze an audio clip or microphone segment

Each endpoint returns a JSON result with:

- `ok`
- `result`
- `latencyMs`

The result includes risk level, score, confidence, summary, indicators, and relevant detection details such as faces or audio segments.

## Notes

- The repository is primarily TypeScript-based on the frontend and Python-based on the backend.
- The system relies on a valid Gemini API credential for actual forensic scoring.
- The frontend and backend are designed to run independently but are intended to work together as a full application.

## License

This project does not currently include a repository license file. If you plan to distribute or publish it, add an appropriate open-source license before release.

## Contributing

Contributions are welcome. If you want to extend the project:

1. Create a feature branch
2. Make your changes
3. Test frontend and backend flows locally
4. Submit a pull request with a clear description of the change

## Repository Summary

DeepGuard is a practical deepfake detection dashboard focused on live and uploaded media analysis. It is structured as a modern full-stack web app with a TypeScript frontend and Python AI-analysis backend, making it suitable for experimentation, demos, and further forensic analysis workflows.
