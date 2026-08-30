import os
import io
import wave
import contextlib
import math
import threading
from typing import List, Dict, Any, Optional

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".webm", ".wma"}
MAX_AUDIO_FILE_SIZE = 100 * 1024 * 1024  # 100 MB

# Process-wide singleton: loading "base" from disk takes real time, and
# concurrent interviews/calls would each load their own copy if this were
# constructed inside transcribe_audio() per request.
_whisper_model = None
# faster-whisper's WhisperModel isn't documented as thread-safe for
# concurrent .transcribe() calls on one instance — now that uploads/turns can
# run in parallel (Phase B), serialize access to the shared model instead of
# risking corrupted/interleaved decode state. Transcription is CPU-bound
# anyway, so this doesn't sacrifice real parallelism, just prevents unsafe
# concurrent use of one model object.
_whisper_lock = threading.Lock()


def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        print("[Audio Pipeline] Loading Faster-Whisper model (base, CPU) — one-time process load...")
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model

def validate_audio_format(file_path: str) -> Dict[str, Any]:
    """
    Validates audio file extension and size.
    Returns dict with is_valid boolean and reason.
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        return {
            "is_valid": False,
            "reason": f"Unsupported audio format '{ext}'. Allowed formats: {', '.join(ALLOWED_AUDIO_EXTENSIONS)}"
        }
    
    if not os.path.exists(file_path):
        return {"is_valid": False, "reason": "Audio file does not exist."}
        
    size = os.path.getsize(file_path)
    if size > MAX_AUDIO_FILE_SIZE:
        return {"is_valid": False, "reason": f"File size ({size / (1024*1024):.1f}MB) exceeds limit of 100MB."}
        
    return {"is_valid": True, "extension": ext, "size": size}

def convert_to_wav(file_path: str) -> str:
    """
    Converts input audio file to standard 16kHz mono WAV format if needed.
    Uses soundfile with PyTorch resampling first, then falls back to pydub/scipy.
    """
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".wav" and not os.path.exists(file_path + ".converted.wav"):
        return file_path
        
    wav_path = file_path + ".converted.wav"
    if os.path.exists(wav_path):
        return wav_path

    # 1. Try soundfile (handles MP3, WAV, FLAC, OGG without external ffmpeg)
    try:
        import soundfile as sf
        import torch
        import torchaudio
        data, sr = sf.read(file_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        tensor = torch.from_numpy(data).unsqueeze(0)
        if sr != 16000:
            tensor = torchaudio.functional.resample(tensor, sr, 16000)
        mono_16k = tensor.squeeze(0).numpy()
        sf.write(wav_path, mono_16k, 16000, subtype="PCM_16")
        print(f"[Audio Pipeline] Converted '{file_path}' (sr={sr}) to 16kHz WAV at '{wav_path}' via soundfile")
        return wav_path
    except Exception as sf_err:
        pass

    # 2. Try pydub / ffmpeg fallback
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_file(file_path)
        audio = audio.set_frame_rate(16000).set_channels(1)
        audio.export(wav_path, format="wav")
        print(f"[Audio Pipeline] Converted '{file_path}' to WAV at '{wav_path}' via pydub")
        return wav_path
    except Exception as e:
        print(f"[Audio Pipeline Warning] Audio conversion fallback: {e}. Using original file directly.")
        return file_path


def load_audio_waveform(file_path: str):
    """
    Loads audio file directly into a 1D or 2D torch.FloatTensor (mono, 16kHz)
    bypassing buggy torchaudio.load dependencies.
    Returns: (waveform_tensor [1, samples], sample_rate: int)
    """
    import torch
    import torchaudio
    import soundfile as sf

    try:
        data, sr = sf.read(file_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        tensor = torch.from_numpy(data).unsqueeze(0)
        if sr != 16000:
            tensor = torchaudio.functional.resample(tensor, sr, 16000)
        return tensor, 16000
    except Exception as sf_err:
        # Fallback: convert to wav and read
        wav_path = convert_to_wav(file_path)
        data, sr = sf.read(wav_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        tensor = torch.from_numpy(data).unsqueeze(0)
        if sr != 16000:
            tensor = torchaudio.functional.resample(tensor, sr, 16000)
        return tensor, 16000

def transcribe_audio(file_path: str) -> List[Dict[str, Any]]:
    """
    Transcribes audio file to timestamped transcript segments.
    Each segment is: {"start": float, "end": float, "text": str}
    Uses faster-whisper with safe fallback options.
    """
    target_path = convert_to_wav(file_path)
    segments_list = []
    
    # 1. Try faster-whisper
    try:
        model = _get_whisper_model()
        # Serialize access to the shared model instance — see _whisper_lock
        # comment above. Held across both the transcribe() call and the
        # segment-generator iteration below, since that's where the actual
        # decode work happens (transcribe() itself just returns a generator).
        with _whisper_lock:
            # language="en" pins the language explicitly — auto-detection is
            # unreliable on short/noisy clips and can pick the wrong language entirely.
            raw_segments, info = model.transcribe(target_path, beam_size=5, vad_filter=True, language="en")

            for s in raw_segments:
                text = s.text.strip()
                if not text:
                    continue
                # Whisper hallucinates text during silence/noise; no_speech_prob and
                # avg_logprob (both on faster-whisper segment objects) flag those
                # low-confidence segments so they don't pollute the transcript.
                no_speech_prob = getattr(s, "no_speech_prob", 0.0) or 0.0
                avg_logprob = getattr(s, "avg_logprob", 0.0) or 0.0
                if no_speech_prob > 0.6 or avg_logprob < -1.0:
                    continue
                segments_list.append({
                    "start": round(s.start, 2),
                    "end": round(s.end, 2),
                    "text": text
                })
            detected_language = info.language
        print(f"[Audio Pipeline] Faster-Whisper transcribed {len(segments_list)} segments. Detected language: {detected_language}")
        # faster-whisper ran cleanly here — an empty result means it heard no
        # speech (or only low-confidence noise), which is a real answer, not
        # an engine failure. Returning it now (even empty) avoids falling
        # through to the ffmpeg-dependent HF fallback below, which would
        # itself fail on a silent/short clip and turn a clean "no speech"
        # into a raw 500.
        return segments_list
    except Exception as fw_err:
        print(f"[Audio Pipeline Warning] Faster-Whisper failed or not available: {fw_err}. Trying HuggingFace / Fallback...")

    # 2. Try Hugging Face pipeline / standard whisper fallback
    try:
        import torch
        from transformers import pipeline
        asr = pipeline("automatic-speech-recognition", model="openai/whisper-tiny", chunk_length_s=30, return_timestamps=True)
        res = asr(target_path)
        chunks = res.get("chunks", [])
        for c in chunks:
            text = c.get("text", "").strip()
            ts = c.get("timestamp", (0.0, 0.0))
            if text:
                segments_list.append({
                    "start": round(ts[0] if ts[0] is not None else 0.0, 2),
                    "end": round(ts[1] if ts[1] is not None else 0.0, 2),
                    "text": text
                })
        if segments_list:
            return segments_list
    except Exception as hf_err:
        print(f"[Audio Pipeline Warning] HuggingFace ASR failed: {hf_err}.")

    # 3. Both engines failed to produce any speech — raise instead of fabricating a
    # placeholder transcript. Silently returning fake text here would mean a live voice
    # query gets "answered" based on words the user never said, and an audio document
    # upload would silently index made-up content as if it were real.
    raise RuntimeError(
        "Could not transcribe this audio: no speech was detected and the fallback "
        "engine failed (ffmpeg may be missing on the server)."
    )

def merge_small_segments(segments: List[Dict[str, Any]], max_duration: float = 30.0, min_chars: int = 120) -> List[Dict[str, Any]]:
    """
    Merges small adjacent timestamped segments into larger coherent blocks.
    - Combines segments until max_duration (e.g. 30 seconds) or min_chars is reached.
    """
    if not segments:
        return []
        
    merged = []
    current_start = segments[0]["start"]
    current_end = segments[0]["end"]
    current_texts = [segments[0]["text"]]
    
    for seg in segments[1:]:
        duration = seg["end"] - current_start
        combined_text_len = sum(len(t) for t in current_texts) + len(seg["text"])
        
        # Merge only while BOTH duration and combined length are still under
        # their caps — using "or" here let short-text segments keep merging
        # indefinitely regardless of accumulated duration, bundling minutes of
        # unrelated speech under one wrong timestamp.
        if duration <= max_duration and combined_text_len < min_chars:
            current_end = seg["end"]
            current_texts.append(seg["text"])
        else:
            merged.append({
                "start": current_start,
                "end": current_end,
                "text": " ".join(current_texts)
            })
            current_start = seg["start"]
            current_end = seg["end"]
            current_texts = [seg["text"]]
            
    if current_texts:
        merged.append({
            "start": current_start,
            "end": current_end,
            "text": " ".join(current_texts)
        })
        
    return merged

def format_timestamp(seconds: float) -> str:
    """Formats float seconds into HH:MM:SS string."""
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"

def chunk_audio_transcript(document_id: str, merged_segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Performs semantic text chunking on merged transcript segments.
    Attaches precise timestamp ranges to each chunk for retrieval citations.
    """
    chunks = []
    for idx, seg in enumerate(merged_segments):
        start_fmt = format_timestamp(seg["start"])
        end_fmt = format_timestamp(seg["end"])
        timestamp_str = f"[{start_fmt} - {end_fmt}]"
        
        chunk_content = f"Timestamp {timestamp_str}: {seg['text']}"
        chunk_id = f"{document_id}_audio_chunk_{idx}"
        
        chunks.append({
            "chunk_id": chunk_id,
            "document_id": document_id,
            "page": 1,
            "section": f"Audio Segment {timestamp_str}",
            "content": chunk_content,
            "start_time": seg["start"],
            "end_time": seg["end"],
            "timestamp_str": timestamp_str,
            "is_audio": True
        })
        
    return chunks

async def generate_tts_audio_async(text: str, voice: str = "en-US-AndrewMultilingualNeural", lang: str = "en") -> Optional[bytes]:
    """
    Generates high-fidelity neural MP3 speech audio bytes using Edge-TTS asynchronously.
    Falls back gracefully to gTTS if Edge-TTS fails or is unavailable.
    """
    if not text or not text.strip():
        return None

    # 1. Primary: Edge-TTS Microsoft Neural Voice (Ultra-low latency, natural inflection)
    try:
        import edge_tts
        communicate = edge_tts.Communicate(text.strip(), voice=voice)
        audio_stream = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
        audio_bytes = audio_stream.getvalue()
        if audio_bytes:
            return audio_bytes
    except Exception as edge_err:
        print(f"[TTS Pipeline Warning] Edge-TTS failed: {edge_err}. Falling back to gTTS...")

    # 2. Resilient Fallback: gTTS
    try:
        from gtts import gTTS
        tts = gTTS(text=text.strip(), lang=lang, slow=False)
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        return fp.read()
    except Exception as gtts_err:
        print(f"[TTS Pipeline Error] gTTS generation also failed: {gtts_err}")
        return None

def generate_tts_audio(text: str, lang: str = "en", voice: str = "en-US-AndrewMultilingualNeural") -> Optional[bytes]:
    """
    Synchronous wrapper for generating MP3 speech audio bytes using Edge-TTS with gTTS fallback.
    """
    import asyncio
    try:
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        if loop.is_running():
            # Running inside an active async event loop in same thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(lambda: asyncio.run(generate_tts_audio_async(text, voice, lang)))
                return future.result()
        else:
            return loop.run_until_complete(generate_tts_audio_async(text, voice, lang))
    except Exception as e:
        print(f"[TTS Sync Error] {e}")
        # Last resort direct gTTS
        try:
            from gtts import gTTS
            tts = gTTS(text=text.strip(), lang=lang, slow=False)
            fp = io.BytesIO()
            tts.write_to_fp(fp)
            fp.seek(0)
            return fp.read()
        except Exception:
            return None
