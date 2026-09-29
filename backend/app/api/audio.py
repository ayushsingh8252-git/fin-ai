import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException, Response, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from ..rate_limit import limiter
from ..services.audio_service import transcribe_audio, validate_audio_format
from ..services import tts_service
from ..services.upload_safety import enforce_upload_size

router = APIRouter()

class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    voice: str = "en-US-AndrewMultilingualNeural"

@router.post("/transcribe")
@limiter.limit("20/minute")
async def transcribe_audio_endpoint(request: Request, file: UploadFile = File(...)):
    """
    Accepts recorded voice audio file (e.g. webm/wav/mp3) from frontend mic
    and returns transcribed text.
    """
    content = await file.read()
    enforce_upload_size(content)

    try:
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        if not suffix or suffix == ".":
            suffix = ".webm"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            # faster-whisper is seconds of CPU work; off the event loop so it
            # doesn't freeze every other request and live interview WebSocket.
            segments = await run_in_threadpool(transcribe_audio, temp_path)
            full_transcript = " ".join([s["text"] for s in segments]).strip()
            return {
                "status": "success",
                "transcript": full_transcript,
                "segments": segments
            }
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

    except Exception as e:
        print(f"[Transcribe API Error] {str(e)}")
        raise HTTPException(status_code=500, detail=f"Audio transcription failed: {str(e)}")

@router.post("/tts")
@limiter.limit("20/minute")
async def text_to_speech_endpoint(request: Request, payload: TTSRequest):
    """
    Converts text to speech for playback. Kokoro (self-hosted) returns
    audio/wav; the Edge/gTTS fallback returns audio/mpeg — clients should
    honor Content-Type (browsers' <audio>/decodeAudioData handle both).
    `voice`/`language` are kept for API compatibility; the Kokoro voice is
    server-configured (KOKORO_VOICE).
    """
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    if len(payload.text) > 5000:
        raise HTTPException(status_code=413, detail="Text too long for speech synthesis")

    result = await tts_service.synthesize(payload.text)
    if not result:
        raise HTTPException(status_code=500, detail="Failed to synthesize speech audio")

    return Response(content=result.audio, media_type=result.media_type,
                    headers={"X-TTS-Provider": result.provider})
