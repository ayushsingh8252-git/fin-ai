"""Quantize ECAPA-TDNN ONNX model to INT8 precision.

Usage:
    python -m scripts.quantize_voice_model [--input models/onnx/ecapa.onnx] [--output models/onnx/ecapa_int8.onnx]
"""
from __future__ import annotations

import os
import sys
import argparse

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import onnxruntime
from onnxruntime.quantization import quantize_dynamic, QuantType


def quantize_ecapa(
    input_path: str = "models/onnx/ecapa.onnx",
    output_path: str = "models/onnx/ecapa_int8.onnx",
) -> str:
    if not os.path.exists(input_path):
        from .export_voice_model import export_ecapa_onnx
        print(f"Input ONNX model '{input_path}' not found. Exporting FP32 first...")
        export_ecapa_onnx(input_path)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    print(f"Quantizing {input_path} to INT8 dynamic quantization -> {output_path}...")
    quantize_dynamic(
        model_input=input_path,
        model_output=output_path,
        weight_type=QuantType.QInt8,
    )

    fp32_size = os.path.getsize(input_path) / 1024 / 1024
    int8_size = os.path.getsize(output_path) / 1024 / 1024

    print(f"Successfully quantized ECAPA-TDNN model:")
    print(f"  FP32 size: {fp32_size:.2f} MB")
    print(f"  INT8 size: {int8_size:.2f} MB (Compression ratio: {fp32_size / max(int8_size, 1e-4):.2f}x)")
    return output_path


def main():
    parser = argparse.ArgumentParser(description="Quantize ECAPA-TDNN ONNX model to INT8")
    parser.add_argument("--input", type=str, default="models/onnx/ecapa.onnx", help="Path to input FP32 ONNX model")
    parser.add_argument("--output", type=str, default="models/onnx/ecapa_int8.onnx", help="Path to output INT8 ONNX model")
    args = parser.parse_args()

    quantize_ecapa(args.input, args.output)


if __name__ == "__main__":
    main()
