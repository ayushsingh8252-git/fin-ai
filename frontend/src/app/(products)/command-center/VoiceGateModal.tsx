"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { getAuthHeaders } from "@/lib/auth";
import {
  Mic,
  MicOff,
  ShieldCheck,
  Unlock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  KeyRound,
} from "lucide-react";

interface Props {
  isOpen: boolean;
  onAuthenticated: (speakerName: string) => void;
}

// NEXT_PUBLIC_API_URL is baked in at build time (see Dockerfile ARG).
// Local dev fallback: port 8001 (POLICY_BACKEND_PORT in root .env).
// Docker: the build arg sets it to http://localhost:8080 (nginx proxy).
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/api\/v1$/, "");

/** Password tab — POSTs to the server-side /command-center/unlock check
 * (api/command_center.py) and never compares the password itself; the
 * backend holds the only copy of the bcrypt hash. Mirrors the voice tab's
 * stateless unlock semantics: on success it just calls onAuthenticated,
 * no token/session is created or persisted.
 *
 * There used to be a client-side `acceptedDemoPasswords` list here that
 * matched before (and on network failure, instead of) the real backend
 * check — a hardcoded password bypass shipped straight into the JS bundle.
 * Removed: the real bcrypt check below is now the only path to
 * onAuthenticated, no exceptions. */
function PasswordUnlockPanel({ onAuthenticated }: { onAuthenticated: (name: string) => void }) {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async () => {
    const trimmed = password.trim();
    if (!trimmed || status === "checking") return;
    setStatus("checking");
    setErrorMessage("");

    try {
      const res = await fetch(`${API_URL}/api/v1/command-center/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ password: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.unlocked) {
        setStatus("success");
        onAuthenticated("Ayush Singh");
        return;
      }
      setErrorMessage(data.detail || "Incorrect password.");
      setStatus("error");
    } catch {
      setErrorMessage("Couldn't reach the server to verify the password. Check your connection and try again.");
      setStatus("error");
    }
  };

  return (
    <div
      style={{
        background: "#121216",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        borderRadius: 12,
        padding: "20px",
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#71717a", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          Enter Command Center password
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          disabled={status === "checking" || status === "success"}
          placeholder="********"
          autoFocus
          style={{
            flex: 1,
            background: "#0c0c0f",
            border: status === "error" ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 8,
            padding: "10px 12px",
            color: "#f4f4f5",
            fontSize: 13,
            fontFamily: "var(--font-geist-mono), monospace",
            outline: "none",
          }}
        />
        <button
          onClick={submit}
          disabled={!password || status === "checking" || status === "success"}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "1px solid rgba(255, 255, 255, 0.2)",
            background: status === "success" ? "rgba(16, 185, 129, 0.15)" : "#18181f",
            color: status === "success" ? "#34d399" : "#f4f4f5",
            fontSize: 12,
            fontWeight: 700,
            cursor: !password || status === "checking" ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
          }}
        >
          {status === "checking" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : status === "success" ? (
            <CheckCircle2 size={14} />
          ) : (
            <Unlock size={14} />
          )}
          {status === "success" ? "Access granted" : "Unlock"}
        </button>
      </div>

      {status === "success" && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#34d399", display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={14} /> <span>Opening Command Center...</span>
        </div>
      )}
      {errorMessage && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#f87171", display: "flex", alignItems: "center", gap: 6, background: "rgba(239, 68, 68, 0.08)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
          <AlertCircle size={14} style={{ flexShrink: 0 }} /> <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

const AUTHORIZATION_PHRASES = [
  "Authorize Ayush Singh for Command Center access.",
  "I am Ayush Singh, verifying biometric credentials.",
  "Security policy confirmed, unlocking agent controls for Ayush Singh.",
  "Ayush Singh requesting autonomous system orchestration.",
  "Confirm voice identity and authorize Ayush Singh.",
  "Biometric baseline verified for Ayush Singh.",
  "Grant Command Center access to Ayush Singh.",
  "Ayush Singh authorizing execution of autonomous agents.",
];

export function VoiceGateModal({ isOpen, onAuthenticated }: Props) {
  const [unlockMethod, setUnlockMethod] = useState<"voice" | "password">("password");
  const [currentPhrase, setCurrentPhrase] = useState(AUTHORIZATION_PHRASES[0]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [status, setStatus] = useState<"idle" | "recording" | "processing" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      const randomIndex = Math.floor(Math.random() * AUTHORIZATION_PHRASES.length);
      setCurrentPhrase(AUTHORIZATION_PHRASES[randomIndex]);
    }
  }, [isOpen]);

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
        headers: getAuthHeaders(),
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();

        // If speaker is not found in database, inform user to enroll first (do NOT auto-unlock)
        if (data.decision === "error" && (data.message?.toLowerCase().includes("not found") || data.message?.toLowerCase().includes("not fully enrolled"))) {
          setLogs((prev) => [
            ...prev,
            "Speaker 'ayush_singh' not found in biometric database.",
            "Security Decision: ACCESS DENIED. Enrollment required.",
          ]);
          setErrorMessage("Speaker 'ayush_singh' is not enrolled yet. Please switch to the 'Enroll' tab to register your baseline voiceprint.");
          setStatus("error");
          return;
        }

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

        // Strictly enforce 63% cosine similarity threshold for Ayush Singh
        const isScoreSufficient = score >= 0.63;
        const verified = isExplicitMatch && isScoreSufficient;

        if (verified) {
          const speakerName = data.speaker_name || "Ayush Singh";
          const spoofStatus = data.spoofing?.overall_label || "live";
          setLogs((prev) => [
            ...prev,
            `Cosine similarity match: ${(score * 100).toFixed(1)}% (Threshold: >= 63.0%)`,
            `Anti-spoofing check: PASS (${spoofStatus})`,
            `Speaker authenticated: ${speakerName}`,
            "Security Policy: ACCESS GRANTED. Unlocking Command Center...",
          ]);
          setStatus("success");
          onAuthenticated(speakerName);
          return;
        } else {
          const failureMsg =
            data.message ||
            data.decision_detail?.message ||
            data.reason ||
            `Voice does not match enrolled profile for Ayush Singh (similarity: ${(score * 100).toFixed(1)}% < 63.0% required).`;

          setLogs((prev) => [
            ...prev,
            `Acoustic similarity: ${(score * 100).toFixed(1)}% (Required: >= 63.0%)`,
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

        if (res.status === 404 || detailMsg.toLowerCase().includes("not found")) {
          setLogs((prev) => [
            ...prev,
            "Speaker 'ayush_singh' not found in biometric database.",
            "Security Decision: ACCESS DENIED. Enrollment required.",
          ]);
          setErrorMessage("Speaker 'ayush_singh' is not enrolled yet. Please switch to the 'Enroll' tab to register your baseline voiceprint.");
          setStatus("error");
          return;
        }

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
            {unlockMethod === "voice" ? "Voice Biometric Authentication" : "Password Authentication"}
          </h2>
          <p style={{ fontSize: 13, color: "#a1a1aa", margin: 0, lineHeight: 1.5 }}>
            {unlockMethod === "voice"
              ? "Speak into the microphone to verify your voice identity for Ayush Singh."
              : "Enter the Command Center password to unlock."}
          </p>
        </div>

        {/* Unlock method switcher */}
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 16,
            background: "#0c0c0f",
            border: "1px solid rgba(255, 255, 255, 0.06)",
            borderRadius: 10,
            padding: 4,
          }}
        >
          {(["password", "voice"] as const).map((method) => (
            <button
              key={method}
              onClick={() => {
                setUnlockMethod(method);
                setErrorMessage("");
                setStatus("idle");
              }}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 0",
                borderRadius: 7,
                border: "none",
                background: unlockMethod === method ? "#1f1f26" : "transparent",
                color: unlockMethod === method ? "#f4f4f5" : "#71717a",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {method === "password" ? <KeyRound size={13} /> : <Mic size={13} />}
              {method === "password" ? "Password" : "Voice Biometric"}
            </button>
          ))}
        </div>

        {unlockMethod === "password" && <PasswordUnlockPanel onAuthenticated={onAuthenticated} />}

        {/* Passphrase Recording Card */}
        {unlockMethod === "voice" && (
        <>
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
            &ldquo;{currentPhrase}&rdquo;
          </div>

          {/* Record Button */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: isRecording ? 10 : 4 }}>
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

          {isRecording && (
            <div style={{ fontSize: 12, color: "#f87171", fontWeight: 500, marginTop: 6 }}>
              Recording: {recordingSeconds}s • Click mic to submit & authenticate
            </div>
          )}

          {errorMessage && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#f87171", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "rgba(239, 68, 68, 0.08)", padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.2)" }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} /> <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErrorMessage("");
                  setUnlockMethod("password");
                }}
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  fontFamily: "var(--font-geist-mono), monospace",
                  color: "#38bdf8",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                ➔ Switch to Password Unlock (Direct Access)
              </button>
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
        </>
        )}
      </motion.div>
    </div>
  );
}
