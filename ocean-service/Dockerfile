FROM python:3.11-slim

WORKDIR /app

# libgl1/libglib2.0-0: opencv-contrib-python and mediapipe both need a real
# (if headless) OpenGL/X11 runtime present to import, not just to render —
# same reason backend/Dockerfile already installs libgl1 for its own
# opencv-python use. ffmpeg: recordings arrive as webm (MediaRecorder
# output) and OCEAN-AI's own pipeline expects mp4 — see
# ocean_service.py::_transcode_to_mp4.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# CPU-only torch wheel first, same rationale and pattern as the main
# backend's Dockerfile (see apps/AI-Policy-Rule-Engine/backend/Dockerfile):
# oceanai's own setup.py pins torch/torchvision/torchaudio with no CPU/GPU
# distinction, so plain `pip install` would otherwise pull PyPI's default
# CUDA-enabled build and several GB of NVIDIA packages this CPU-only
# deployment (see docs/behavioral-analysis.md) never uses.
RUN pip install --no-cache-dir --default-timeout=100 --retries=5 \
    torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# transformers is EXACT-pinned (==4.45.1) by oceanai itself — install the
# rest of requirements.txt (also exact/minimum-pinned to match oceanai's own
# setup.py, see that file's own header comment) before oceanai so pip's
# resolver never has to reconcile oceanai's declared deps against an
# already-installed, possibly-newer transformers.
RUN pip install --no-cache-dir --default-timeout=100 --retries=5 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

# --no-deps: every real runtime dependency oceanai declares (including
# ipython/jupyterlab/gradio — verified live to be hard imports in its actual
# inference code, not just notebook-only extras; see requirements.txt's own
# header comment) was already installed above from our own pinned
# requirements.txt. --no-deps here only avoids pip re-resolving oceanai's
# own declared version ranges against what we just installed.
RUN pip install --no-cache-dir --no-deps oceanai==1.0.0a48

COPY . .

RUN mkdir -p data/weights data/logs uploads/interview_recordings && chmod -R 777 /app

ENV PORT=8100
# gradio (a hard import of oceanai, see requirements.txt) otherwise calls
# api.gradio.app at import time — observed live during E2E validation. This
# service handles candidate recordings and must not phone home.
ENV GRADIO_ANALYTICS_ENABLED=False
ENV ANALYSIS_WORK_DIR=/tmp/ocean_analysis
EXPOSE 8100

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
