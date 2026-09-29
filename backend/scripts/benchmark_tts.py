"""Real TTS latency benchmark: Kokoro (via the production tts_service path,
sentence streaming included) vs. the previous provider chain.

    cd backend && python scripts/benchmark_tts.py [--runs 3] [--baseline]

Reports model startup, time to first playable audio (TTFB), full generation
time, audio duration, real-time factor, average CPU cores used and process
RSS. Texts are representative interviewer lines. Run on an otherwise idle
machine — Kokoro is CPU-bound, so anything else running skews the numbers.
"""

import argparse
import asyncio
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEXTS = {
    "short (~2 s)": "Thanks for sharing that. Let's move on.",
    "medium (~5 s)": (
        "Thanks for that. Could you walk me through a recent project where you "
        "designed a backend service end to end?"
    ),
    "long (~10 s)": (
        "That's a helpful overview. Could you tell me more about the databases and caching "
        "layers you've worked with, and how you decided between them? I'm especially "
        "interested in how you handled cache invalidation when the data changed."
    ),
}


def rss_mb() -> float:
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class PMC(ctypes.Structure):
            _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                        ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                        ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]
        pmc = PMC()
        pmc.cb = ctypes.sizeof(PMC)
        get_proc = ctypes.windll.kernel32.GetCurrentProcess
        get_proc.restype = wintypes.HANDLE  # default int restype truncates the 64-bit pseudo-handle
        get_info = ctypes.windll.psapi.GetProcessMemoryInfo
        get_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
        get_info(get_proc(), ctypes.byref(pmc), pmc.cb)
        return pmc.WorkingSetSize / 2**20
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    return float("nan")


async def measure_stream(text: str) -> dict:
    from app.services import tts_service

    t0, c0 = time.perf_counter(), time.process_time()
    first = None
    audio_ms = 0
    chunks = 0
    async for chunk in tts_service.stream_speech(text):
        if first is None:
            first = time.perf_counter() - t0
        audio_ms += chunk.duration_ms or 0
        chunks += 1
    wall = time.perf_counter() - t0
    return {"ttfb": first, "total": wall, "audio": audio_ms / 1000, "chunks": chunks,
            "cores": (time.process_time() - c0) / wall}


def measure_baseline(text: str) -> dict:
    from app.services.audio_service import generate_tts_audio

    t0 = time.perf_counter()
    audio = generate_tts_audio(text)
    wall = time.perf_counter() - t0
    # The old path returns one complete MP3: first playable audio == total.
    return {"ttfb": wall, "total": wall, "bytes": len(audio or b"")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--baseline", action="store_true", help="also time the previous Edge/gTTS chain (network)")
    args = ap.parse_args()

    from app.config import settings
    from app.services.kokoro_tts import get_kokoro_service

    settings.TTS_PROVIDER = "kokoro"
    rss0 = rss_mb()
    svc = get_kokoro_service()
    t0 = time.perf_counter()
    svc.load()
    startup = time.perf_counter() - t0
    print(f"\nmodel={svc.model_id} voice={svc.voice} device={svc.device} cpu_count={os.cpu_count()} "
          f"threads={settings.KOKORO_THREADS or min(os.cpu_count() or 1, 8)}")
    print(f"startup (load + warm-up): {startup * 1000:.0f} ms   RSS before={rss0:.0f} MB after={rss_mb():.0f} MB")

    med = statistics.median
    print(f"\n{'text':<15}{'chunks':>7}{'audio s':>9}{'TTFB ms':>9}{'total ms':>10}{'RTF':>7}{'cores':>7}")
    for label, text in TEXTS.items():
        runs = [asyncio.run(measure_stream(text)) for _ in range(args.runs)]
        r = {k: med([x[k] for x in runs]) for k in runs[0]}
        print(f"{label:<15}{r['chunks']:>7.0f}{r['audio']:>9.2f}{r['ttfb'] * 1000:>9.0f}"
              f"{r['total'] * 1000:>10.0f}{r['total'] / r['audio']:>7.2f}{r['cores']:>7.1f}")
    print(f"peak-ish RSS after runs: {rss_mb():.0f} MB")

    if args.baseline:
        print("\nprevious provider chain (audio_service.generate_tts_audio: Edge-TTS -> gTTS), whole-file MP3:")
        for label, text in TEXTS.items():
            runs = [measure_baseline(text) for _ in range(args.runs)]
            each = ", ".join("%.0f" % (x["total"] * 1000) for x in runs)
            print(f"{label:<15} TTFB=total={med([x['total'] for x in runs]) * 1000:.0f} ms  (runs: {each})")


if __name__ == "__main__":
    main()
