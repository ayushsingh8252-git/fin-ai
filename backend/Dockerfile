FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# torch/torchaudio come in transitively via sentence-transformers/speechbrain
# with no version pin, which pulls PyPI's default GPU build (and several GB
# of NVIDIA CUDA packages) even though every model here (ECAPA-TDNN speaker
# encoder, bge-base embeddings, Whisper) runs CPU-only in this deployment —
# see voice_identification.py's VOICE_INFERENCE_BACKEND default. Installing
# the CPU-only wheel first satisfies requirements.txt's implicit constraint
# without pip ever reaching for the CUDA build, cutting image size/build time
# substantially — matters both for local iteration and for not burning EC2
# disk/bandwidth on GPU support that will never be used.
RUN pip install --no-cache-dir --default-timeout=100 --retries=5 \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --default-timeout=100 --retries=5 \
    --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

COPY . .

RUN mkdir -p uploads data && chmod -R 777 /app

ENV PORT=8000
EXPOSE 8000

# Shell form so $PORT expands — lets docker-compose (PORT=8000) and HF Spaces
# (PORT=7860, set as a Space secret) share this same Dockerfile.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
