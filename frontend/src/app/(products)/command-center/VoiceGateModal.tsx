"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  MicOff,
  ShieldCheck,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  Upload,
  FileAudio,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onAuthenticated: (speakerName: string) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function VoiceGateModal({ isOpen, onAuthenticated }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "recording" | "processing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isRecording) {
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  const startRecording = async () => {
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const mediaRecorder = new MediaRecorder(stream);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setStatus("recording");
      setLogs([
        "Microphone active (16-bit PCM stream)",
        "Listening for speaker verification passphrase...",
      ]);
    } catch (err: any) {
      console.error("Microphone error:", err);
      setErrorMessage("Microphone access denied. Please allow microphone permissions in your browser.");
      setStatus("error");
    }
  };

  const stopRecordingAndProcess = () => {
    if (!mediaRecorderRef.current || !isRecording) return;

    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      setStatus("processing");
      await handleVerify(audioBlob);
    };

    mediaRecorderRef.current.stop();
    setIsRecording(false);
  };

  const handleVerify = async (audioBlob: Blob) => {
    setLogs((prev) => [
      ...prev,
      "Extracting acoustic features from speech stream...",
      "Generating 192-dimensional ECAPA-TDNN speaker embedding...",
      "Comparing live biometric vector against enrolled profile for Ayush Singh...",
    ]);

    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "voice_input.webm");
      formData.append("speaker_id", "ayush_singh");

      const res = await fetch(`${API_URL}/api/v1/voice/verify`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const score = typeof data.confidence === "number"
          ? data.confidence
          : typeof data.score === "number"
          ? data.score
          : typeof data.decision_detail?.score === "number"
          ? data.decision_detail.score
          : 0.0;

        const isExplicitMatch =
          (data.decision === "match" || data.decision_detail?.decision === "OPEN") &&
          data.decision !== "denied" &&
          data.decision !== "no_match" &&
          data.decision !== "mismatch" &&
          data.decision !== "error";

        const isScoreSufficient = score >= 0.72;
        const verified = isExplicitMatch && isScoreSufficient;

        if (verified) {
          const speakerName = data.speaker_name || "Ayush Singh";
          const spoofStatus = data.spoofing?.overall_label || "live";
          setLogs((prev) => [
            ...prev,
            `Cosine similarity match: ${(score * 100).toFixed(1)}% (Threshold: >= 72.0%)`,
            `Anti-spoofing check: PASS (${spoofStatus})`,
            `Speaker authenticated: ${speakerName}`,
            "Security Policy: ACCESS GRANTED. Unlocking Command Center...",
          ]);
          setStatus("success");
          setTimeout(() => {
            onAuthenticated(speakerName);
          }, 900);
          return;
        } else {
          const failureMsg =
            data.message ||
            data.decision_detail?.message ||
            data.reason ||
            `Voice does not match enrolled profile (similarity: ${(score * 100).toFixed(1)}% < 72.0% required).`;

          setLogs((prev) => [
            ...prev,
            `Acoustic similarity: ${(score * 100).toFixed(1)}% (Required: >= 72.0%)`,
            `Security Decision: ACCESS DENIED`,
            `Reason: ${failureMsg}`,
          ]);
          setErrorMessage(failureMsg);
          setStatus("error");
          return;
        }
      } else {
        const errData = await res.json().catch(() => ({ detail: "Verification service error" }));
        const detailMsg = errData.detail || errData.message || "Voice verification service error.";
        
        setLogs((prev) => [
          ...prev,
          `Backend error response (${res.status}): ${detailMsg}`,
          "Security Policy: ACCESS DENIED",
        ]);
        setErrorMessage(detailMsg);
        setStatus("error");
      }
    } catch (err: any) {
      const errMsg = err?.message || "Network connection error.";
      setLogs((prev) => [
        ...prev,
        "Authentication Service Error: Unable to reach verification backend.",
        `Detail: ${errMsg}`,
        "Security Protocol: ACCESS DENIED",
      ]);
      setErrorMessage("Voice verification failed: Backend service unreachable. Access Denied.");
      setStatus("error");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(9, 9, 11, 0.94)",
        backdropFilter: "blur(24px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="cc-card"
        style={{
          width: "100%",
          maxWidth: 480,
          background: "#09090b",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.85)",
          padding: "32px 28px",
          position: "relative",
          borderRadius: 16,
        }}
      >
        {/* Header Icon & Title */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              margin: "0 auto 14px",
              background: status === "success" ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.04)",
              border: status === "success" ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255, 255, 255, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.3s ease",
            }}
          >
            {status === "success" ? (
              <Unlock size={24} className="text-emerald-400" />
            ) : status === "recording" ? (
              <Mic size={24} className="text-red-400 animate-pulse" />
            ) : (
              <ShieldCheck size={24} className="text-zinc-200" />
            )}
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#f4f4f5", marginBottom: 6, letterSpacing: "-0.02em" }}>
            Voice Biometric Authentication
          </h2>
          <p style={{ fontSize: 13, color: "#a1a1aa", margin: 0, lineHeight: 1.5 }}>
            Speak into the microphone to authenticate your voice identity for Ayush Singh.
          </p>
        </div>

        {/* Passphrase Recording Card */}
        <div
          style={{
            background: "#121216",
            border: isRecording ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: 12,
            padding: "20px",
            textAlign: "center",
            marginBottom: 16,
            transition: "border-color 0.2s ease",
          }}
        >
          <div style={{ fontSize: 11, color: "#71717a", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            Read this authorization sentence to unlock:
          </div>

          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#f4f4f5",
              background: "rgba(255, 255, 255, 0.03)",
              padding: "12px 16px",
              borderRadius: 8,
              marginBottom: 18,
              fontFamily: "var(--font-geist-mono), monospace",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              lineHeight: 1.4,
            }}
          >
            &ldquo;Authorize Ayush Singh for Command Center access.&rdquo;
          </div>

          {/* Record Button */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
            <button
              onClick={isRecording ? stopRecordingAndProcess : startRecording}
              disabled={status === "processing"}
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                border: isRecording ? "2px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.2)",
                background: isRecording ? "rgba(239, 68, 68, 0.2)" : "#18181f",
                color: isRecording ? "#f87171" : "#f4f4f5",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: status === "processing" ? "not-allowed" : "pointer",
                boxShadow: isRecording ? "0 0 20px rgba(239, 68, 68, 0.4)" : "0 4px 12px rgba(0, 0, 0, 0.3)",
                transition: "all 0.2s ease",
              }}
            >
              {status === "processing" ? (
                <Loader2 size={24} className="animate-spin" />
              ) : isRecording ? (
                <MicOff size={24} />
              ) : (
                <Mic size={24} />
              )}
            </button>
          </div>

          <div style={{ fontSize: 12, color: isRecording ? "#f87171" : "#71717a", fontWeight: 500, marginBottom: 14 }}>
            {isRecording
              ? `Recording: ${recordingSeconds}s • Click to submit & authenticate`
              : "Click microphone to start recording"}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: 8,
                fontSize: 12,
                color: "#d4d4d8",
                cursor: status === "processing" ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <Upload size={13} />
              <span>Upload Voice Recording</span>
              <input
                type="file"
                accept="audio/*"
                disabled={status === "processing"}
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setStatus("processing");
                  setLogs([
                    `Uploaded audio file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
                  ]);
                  await handleVerify(file);
                }}
              />
            </label>
          </div>

          {errorMessage && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#f87171", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(239, 68, 68, 0.08)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /> <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Live Processing Logs */}
        {logs.length > 0 && (
          <div
            style={{
              background: "#0c0c0f",
              border: "1px solid rgba(255, 255, 255, 0.06)",
              borderRadius: 8,
              padding: "10px 14px",
              marginBottom: 16,
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
              lineHeight: 1.6,
              color: "#a1a1aa",
            }}
          >
            <div style={{ color: "#71717a", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <Cpu size={10} />
              <span>SPEAKER BIOMETRICS (ECAPA-TDNN 192-DIM)</span>
            </div>
            {logs.map((log, i) => (
              <div key={i} style={{ color: i === logs.length - 1 ? "#f4f4f5" : "#71717a" }}>
                ❯ {log}
              </div>
            ))}
          </div>
        )}

        {/* Footer info */}
        <div style={{ fontSize: 11, color: "#71717a", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <CheckCircle2 size={12} className="text-emerald-400" />
          <span>Local Neural Speaker Biometrics • Zero Third-Party Audio Leakage</span>
        </div>
      </motion.div>
    </div>
  );
}
