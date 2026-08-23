FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --default-timeout=100 --retries=5 -r requirements.txt \
    && python -m spacy download en_core_web_sm

COPY . .

RUN mkdir -p uploads data && chmod -R 777 /app

ENV PORT=8000
EXPOSE 8000

# Shell form so $PORT expands — lets docker-compose (PORT=8000) and HF Spaces
# (PORT=7860, set as a Space secret) share this same Dockerfile.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
