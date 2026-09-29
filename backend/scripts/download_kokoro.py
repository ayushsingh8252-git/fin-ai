"""Download the Kokoro-82M ONNX model + voice table (once) and verify them.

    python scripts/download_kokoro.py [--int8] [--dest models/kokoro]

Idempotent: files already present with the right SHA-256 are skipped, so the
Docker build layer (and a local re-run) never re-downloads. Stdlib only.
Source: the kokoro-onnx project's model-files-v1.0 release.
"""

import argparse
import hashlib
import os
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
FILES = {
    "kokoro-v1.0.onnx": "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
INT8 = {"kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(name: str, digest: str, dest: Path) -> None:
    target = dest / name
    if target.is_file() and sha256(target) == digest:
        print(f"[kokoro] {name}: present, checksum ok")
        return
    tmp = target.with_suffix(target.suffix + ".part")
    print(f"[kokoro] downloading {name} ...")
    with urllib.request.urlopen(f"{BASE}/{name}", timeout=60) as r, tmp.open("wb") as out:
        while block := r.read(1 << 20):
            out.write(block)
    actual = sha256(tmp)
    if actual != digest:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"[kokoro] checksum mismatch for {name}: {actual}")
    os.replace(tmp, target)
    print(f"[kokoro] {name}: {target.stat().st_size / 2**20:.0f} MB ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=str(Path(__file__).resolve().parents[1] / "models" / "kokoro"))
    ap.add_argument("--int8", action="store_true", help="also fetch the int8 model (slower on some CPUs — benchmark first)")
    args = ap.parse_args()
    dest = Path(args.dest)
    dest.mkdir(parents=True, exist_ok=True)
    for name, digest in {**FILES, **(INT8 if args.int8 else {})}.items():
        fetch(name, digest, dest)


if __name__ == "__main__":
    sys.exit(main())
