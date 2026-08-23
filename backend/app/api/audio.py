import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException, Response
from pydantic import BaseModel
from ..services.audio_service import transcribe_audio, generate_tts_audio_async, validate_audio_format

router = APIRouter()

class TTSRequest(BaseModel):
    text: str
    language: str = "en"
    voice: str = "en-US-AndrewMultilingualNeural"

@router.post("/transcribe")
async def transcribe_audio_endpoint(file: UploadFile = File(...)):
    """
    Accepts recorded voice audio file (e.g. webm/wav/mp3) from frontend mic
    and returns transcribed text.
    """
    try:
        suffix = os.path.splitext(file.filename)[1] if file.filename else ".webm"
        if not suffix or suffix == ".":
            suffix = ".webm"
            
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            segments = transcribe_audio(temp_path)
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
async def text_to_speech_endpoint(request: TTSRequest):
    """
    Converts text to speech MP3 audio stream for playback using neural voice.
    """
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
        
    audio_bytes = await generate_tts_audio_async(request.text, voice=request.voice, lang=request.language)
    if not audio_bytes:
        raise HTTPException(status_code=500, detail="Failed to synthesize speech audio")
        
    return Response(content=audio_bytes, media_type="audio/mpeg")
