"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, Mic, Loader2, AlertTriangle, Volume2, MessageSquare,
  Send, LogOut, ScreenShare, Download, CheckCircle2, Brain, PhoneOff, Sparkles, RotateCcw,
} from "lucide-react";
import { useProctoring, type FaceBox, type ProctoringState } from "@/hooks/useProctoring";
import { StreamingSpeechPlayer, base64ToArrayBuffer, type SpeechOutcome } from "@/lib/streamingSpeechPlayer";
import type {
  EvaluationResult, InterviewPhase, ResumeProfileOut, ScreeningStartResponse, TranscriptTurn,
} from "./types";
import { Toast, type ToastState } from "./Toast";
import InterviewReport from "./InterviewReport";
import { getLlmopsHeaders } from "@/lib/llmopsIdentity";
import { getAuthHeaders } from "@/lib/auth";
import { getApiBaseUrl } from "@/lib/apiConfig";

const API_URL = getApiBaseUrl();
const INTERVIEWER_NAME = "Ayush";
const DEFAULT_ROLE = "Backend Engineer";

// Voice-activity detection tuning for the hands-free "just talk" mic — no
// record button, the candidate's own speech starts and stops the turn.
const VAD_SPEECH_RMS_THRESHOLD = 0.025;
const VAD_SILENCE_STOP_MS = 1300;
const VAD_NO_SPEECH_TIMEOUT_MS = 12000;
const VAD_MAX_RECORD_MS = 45000;

// Barge-in: the candidate talking over the interviewer stops its speech.
// Stricter than the answer VAD (louder + sustained) because the mic can
// still pick up some of the interviewer's own voice from the speakers even
// with the browser's echo cancellation on.
// Loud time accumulates and quiet time drains it at half rate, rather than
// requiring unbroken loudness: measured on real speech, only ~55% of 10 ms
// windows clear this level (dips between syllables), so a "continuously
// loud for N ms" rule fired ~3 s late in live testing.
const BARGE_IN_ENABLED = true;
const BARGE_IN_RMS_THRESHOLD = 0.05;
const BARGE_IN_TRIGGER_MS = 300;

// How many candidate answers the adaptive interview loop (POST
// /interview/turn) asks for before wrapping up — mirrors the backend's
// own max_turns default and drives the "Question X of N" display.
const MAX_CANDIDATE_TURNS = 6;

/** Compact resume summary handed to the per-turn LLM so follow-up questions
 * stay grounded in what's actually on the candidate's resume, not just the
 * role/JD — without re-sending the full raw resume text every turn. */
function buildResumeContext(profile: ResumeProfileOut): string {
  const parts: string[] = [];
  if (profile.candidate_name) parts.push(`Name: ${profile.candidate_name}`);
  if (profile.skills?.length) parts.push(`Skills: ${profile.skills.join(", ")}`);
  if (profile.past_roles?.length) parts.push(`Past roles: ${profile.past_roles.join("; ")}`);
  if (profile.projects?.length) parts.push(`Projects: ${profile.projects.join("; ")}`);
  if (profile.tech_stack?.length) parts.push(`Tech stack: ${profile.tech_stack.join(", ")}`);
  if (profile.resume_highlight) parts.push(`Highlight: ${profile.resume_highlight}`);
  return parts.join("\n");
}

/** One retry after a short backoff, plus a hard client-side timeout — a
 * request that just hangs (dead connection, an LLM call that never returns)
 * used to leave the UI stuck on "Processing…" forever, since fetch() has no
 * default timeout of its own. Each call site picks a timeout that fits what
 * it's waiting on (a quick DB write vs. an LLM-backed evaluation). */
async function fetchWithRetry(
  input: string,
  init?: RequestInit,
  retries = 1,
  timeoutMs = 20000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    if (!res.ok && res.status >= 500 && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return fetchWithRetry(input, init, retries - 1, timeoutMs);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return fetchWithRetry(input, init, retries - 1, timeoutMs);
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

interface VoiceCheckEntry {
  id: string;
  label: string;
  at: string;
}

interface VoiceCheckState {
  status: "off" | "starting" | "enrolling" | "active" | "degraded" | "unavailable";
  candidateVerified: boolean;
  additionalSpeaker: boolean;
  wasCleared: boolean;
  timeline: VoiceCheckEntry[];
}

const INITIAL_VOICE_CHECK: VoiceCheckState = {
  status: "off", candidateVerified: false, additionalSpeaker: false, wasCleared: false, timeline: [],
};

type SpeakerMessage = {
  type: string;
  event?: string;
  status?: string;
  timestamp?: string;
  duration_ms?: number;
  additional_speakers?: number;
  audio_context?: { reference_status?: string; analysis_status?: string; additional_speaker_detected?: boolean };
};

const fmtMs = (ms?: number) => (ms == null ? "" : ` · ${(ms / 1000).toFixed(1)} sec`);

/** Folds one speaker-monitor WebSocket message into the live state. Wording
 * stays neutral: it reports what was heard, never a verdict. */
function applySpeakerMessage(prev: VoiceCheckState, msg: SpeakerMessage): VoiceCheckState {
  if (msg.type === "audio_stream_status") {
    return { ...prev, status: msg.status === "started" ? "starting" : "unavailable" };
  }
  if (msg.type === "audio_speaker_state" && msg.audio_context) {
    const c = msg.audio_context;
    return {
      ...prev,
      status: c.analysis_status === "degraded" ? "degraded" : c.reference_status === "ready" ? "active" : "enrolling",
      additionalSpeaker: Boolean(c.additional_speaker_detected),
    };
  }
  if (msg.type !== "audio_speaker_event") return prev;
  const at = msg.timestamp || new Date().toISOString();
  const add = (label: string) => [{ id: `${msg.event}-${at}`, label, at }, ...prev.timeline].slice(0, 20);
  switch (msg.event) {
    case "CANDIDATE_SPEAKER_CONFIRMED":
      return { ...prev, status: "active", candidateVerified: true, timeline: add("Candidate voice verified") };
    case "MULTIPLE_SPEAKERS_DETECTED":
      return {
        ...prev, additionalSpeaker: true, wasCleared: false,
        timeline: add(msg.additional_speakers && msg.additional_speakers > 1
          ? `Additional speakers detected (${msg.additional_speakers})` : "Additional speaker detected"),
      };
    case "MULTIPLE_SPEAKERS_CLEARED":
      return { ...prev, additionalSpeaker: false, wasCleared: true, timeline: add(`Audio monitoring normal${fmtMs(msg.duration_ms)}`) };
    case "UNKNOWN_SPEAKER_STARTED":
      return { ...prev, additionalSpeaker: true };
    case "AUDIO_ANALYSIS_DEGRADED":
      return { ...prev, status: "degraded", timeline: add("Audio analysis temporarily unavailable") };
    case "AUDIO_ANALYSIS_RECOVERED":
      return { ...prev, status: prev.candidateVerified ? "active" : "enrolling", timeline: add("Audio analysis recovered") };
    default:
      return prev;
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface InterviewRoomProps {
  initialRoleTitle?: string;
  initialJdText?: string;
  sessionId?: string;
  email?: string;
  roleFieldsLocked?: boolean;
  /** Invite-link mode: the candidate sees a submission confirmation, not the
   * scored report — that evaluation is for the hiring team (Recruitment). */
  candidateView?: boolean;
}

export default function InterviewRoom({
  initialRoleTitle = DEFAULT_ROLE,
  initialJdText = "",
  sessionId,
  email,
  roleFieldsLocked = false,
  candidateView = false,
}: InterviewRoomProps) {
  const {
    videoRef, state: proctoring, faceBoxes,
    start: startProctoring, stop: stopProctoring, notifyInterviewPhase,
  } = useProctoring(sessionId);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);

  const [roleTitle, setRoleTitle] = useState(initialRoleTitle);
  const [jdText, setJdText] = useState(initialJdText);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [phase, setPhase] = useState<InterviewPhase>("setup");
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const resumeContextRef = useRef<string>("");
  const resumeSkillsRef = useRef<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState<string | null>(null);
  const [inviteSending, setInviteSending] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Opt-in screen recording, saved locally only — never uploaded. Off by
  // default; the browser's own share-picker is the actual consent prompt,
  // this checkbox just decides whether we ask for it at all.
  const [screenRecordingEnabled, setScreenRecordingEnabled] = useState(false);
  const [isRecordingScreen, setIsRecordingScreen] = useState(false);
  const [screenRecordingBlob, setScreenRecordingBlob] = useState<Blob | null>(null);
  const [screenRecordingError, setScreenRecordingError] = useState<string | null>(null);
  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);

  // Opt-in behavioral-analysis recording — camera + mic, continuous for the
  // whole interview, uploaded to the backend on completion so OCEAN-AI can
  // analyze it (see api/interview.py's upload_interview_recording). Off by
  // default and a SEPARATE getUserMedia call from useProctoring's own
  // video-only stream, deliberately: this is the one recording path in the
  // product that actually leaves the browser, so it stays its own isolated
  // opt-in rather than silently piggy-backing on proctoring's stream.
  const [behavioralRecordingConsent, setBehavioralRecordingConsent] = useState(false);
  // Opt-in voice check: each answer clip already sent to /transcribe is also
  // checked server-side for voices that don't match the candidate's own
  // (services/speaker_monitor.py). Results arrive over the interview WS.
  const [speakerMonitorConsent, setSpeakerMonitorConsent] = useState(false);
  const [voiceCheck, setVoiceCheck] = useState<VoiceCheckState>(INITIAL_VOICE_CHECK);
  const speakerConsentRef = useRef(false);
  const speakerAudioRef = useRef<{ ctx: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null>(null);
  const avRecorderRef = useRef<MediaRecorder | null>(null);
  const avStreamRef = useRef<MediaStream | null>(null);
  const avChunksRef = useRef<Blob[]>([]);
  const avMimeTypeRef = useRef<string>("video/webm");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  // One player for every interviewer line (streamed WS chunks and /tts
  // bodies alike), so two utterances can never overlap.
  const playerRef = useRef<StreamingSpeechPlayer | null>(null);
  const getPlayer = useCallback(() => (playerRef.current ??= new StreamingSpeechPlayer()), []);
  const currentTurnIdRef = useRef<string | null>(null);
  const wsSpeechRef = useRef<Promise<SpeechOutcome> | null>(null);
  // Set once the candidate ends the call — any turn still in flight
  // (LLM reply, transcription) must not speak or advance afterwards.
  const endedRef = useRef(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [speechAnalyser, setSpeechAnalyser] = useState<AnalyserNode | null>(null);
  // Voice latency bookkeeping (Date.now() ms): when the candidate stopped
  // speaking, and how long /transcribe took for that answer.
  const speechEndAtRef = useRef<number | null>(null);
  const lastSttMsRef = useRef<number | null>(null);
  // Sentences of the interviewer line currently being streamed, shown as a
  // live caption before the full text (turn_result) exists.
  const [liveCaption, setLiveCaption] = useState("");
  // The report renders in-page (the full-screen call closes); bring it into
  // view instead of leaving the user wherever the page was scrolled.
  const reportRef = useRef<HTMLDivElement | null>(null);
  const reportReady = phase === "complete" && evaluation !== null;
  useEffect(() => {
    if (reportReady) reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [reportReady]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const emptyAnswerStreakRef = useRef(0);

  const vadRafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceSinceRef = useRef<number | null>(null);
  const recordingStartedAtRef = useRef(0);
  const [micLevel, setMicLevel] = useState(0);
  const [hasHeardSpeech, setHasHeardSpeech] = useState(false);

  const startedAtRef = useRef<number>(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Initialize WebSocket for ultra-low latency turns
  useEffect(() => {
    if (phase === "setup" || phase === "complete") {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
      try {
        const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsHost = (API_URL || (typeof window !== "undefined" ? window.location.host : "localhost:8000")).replace(/^https?:\/\//, "");
        // Deliberately unauthenticated — a candidate on an invite link was
        // never a signed-in platform user, and the session_id itself is the
        // access control (see api/interview.py's WS route docstring).
        const wsUrl = `${wsProtocol}//${wsHost}/api/v1/interview/ws/${sessionId || "demo-session"}`;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
          // (Re)start the speaker-monitor stream on every (re)connect.
          if (speakerConsentRef.current) ws.send(JSON.stringify({ type: "audio_stream_start", consent: true }));
        };

        ws.onerror = (e) => {
          console.warn("[Interview WebSocket Warning]", e);
        };

        ws.addEventListener("message", (evt) => {
          try {
            const msg = JSON.parse(evt.data) as SpeakerMessage;
            if (msg.type.startsWith("audio_speaker_") || msg.type === "audio_stream_status") {
              setVoiceCheck((prev) => applySpeakerMessage(prev, msg));
            }
          } catch {}
        });
      } catch (err) {
        console.warn("[Interview WebSocket Connect Failed]", err);
      }
    }

    return () => {
      if (wsRef.current && (phase === "complete" as InterviewPhase || phase === "setup" as InterviewPhase)) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [phase, sessionId]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcript]);

  // Tell the proctoring hook whenever the AI interviewer starts/stops
  // talking, so its audio monitor can apply the stricter cross-talk check.
  useEffect(() => {
    notifyInterviewPhase(phase === "speaking" ? "speaking" : "other");
  }, [phase, notifyInterviewPhase]);

  // Tag the speaker-monitor stream with who should be talking: a voice that
  // doesn't match the candidate while the AI speaks may be the interviewer's
  // own audio leaking into the mic, so the server treats it as unresolved.
  useEffect(() => {
    const ws = wsRef.current;
    if (!speakerConsentRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "audio_phase",
      phase: phase === "speaking" ? "ai_speaking" : "candidate",
      turn_index: transcript.filter((t) => t.role === "candidate").length,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);


  useEffect(() => {
    if (phase === "setup" || phase === "complete" || phase === "error") return;
    const id = window.setInterval(() => {
      setElapsedMs(startedAtRef.current ? Date.now() - startedAtRef.current : 0);
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  const stopVadLoop = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    hasSpokenRef.current = false;
    silenceSinceRef.current = null;
    setMicLevel(0);
    setHasHeardSpeech(false);
  }, []);

  const startVadLoop = useCallback((stream: MediaStream) => {
    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxCtor) return;

    const ctx = new AudioCtxCtor();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);

    recordingStartedAtRef.current = Date.now();
    hasSpokenRef.current = false;
    silenceSinceRef.current = null;
    let lastUiUpdate = 0;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const norm = (data[i] - 128) / 128;
        sumSquares += norm * norm;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = Date.now();

      if (now - lastUiUpdate > 100) {
        lastUiUpdate = now;
        setMicLevel(Math.min(1, rms * 6));
      }

      if (rms > VAD_SPEECH_RMS_THRESHOLD) {
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          setHasHeardSpeech(true);
        }
        silenceSinceRef.current = null;
      } else if (hasSpokenRef.current) {
        if (silenceSinceRef.current === null) silenceSinceRef.current = now;
        else if (now - silenceSinceRef.current > VAD_SILENCE_STOP_MS) {
          // The candidate actually stopped talking when the silence began,
          // not now — latency is measured from that moment.
          speechEndAtRef.current = silenceSinceRef.current;
          mediaRecorderRef.current?.stop();
          return;
        }
      } else if (now - recordingStartedAtRef.current > VAD_NO_SPEECH_TIMEOUT_MS) {
        mediaRecorderRef.current?.stop();
        return;
      }

      if (now - recordingStartedAtRef.current > VAD_MAX_RECORD_MS) {
        mediaRecorderRef.current?.stop();
        return;
      }

      vadRafRef.current = requestAnimationFrame(tick);
    };
    vadRafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    return () => {
      stopProctoring();
      stopVadLoop();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      avStreamRef.current?.getTracks().forEach((t) => t.stop());
      speakerAudioRef.current?.stream.getTracks().forEach((t) => t.stop());
      speakerAudioRef.current?.ctx.close().catch(() => {});
      playerRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addTurn = useCallback((role: TranscriptTurn["role"], text: string) => {
    const turn: TranscriptTurn = { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, text };
    setTranscript((prev) => [...prev, turn]);
    return turn;
  }, []);

  /** Speaks a line via POST /tts (greeting, fixed prompts, and the HTTP
   * fallback path). The body is WAV from Kokoro or MP3 from the fallback. */
  const speak = useCallback(async (text: string): Promise<SpeechOutcome> => {
    if (endedRef.current) return "interrupted";
    setPhase("speaking");
    const player = getPlayer();
    const done = player.begin();
    try {
      const res = await fetchWithRetry(`${API_URL}/api/v1/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: "en" }),
      });
      if (!res.ok) throw new Error("TTS request failed");
      player.push(await res.arrayBuffer());
    } catch (err) {
      console.error("TTS playback failed", err);
    }
    player.finish();
    return done;
  }, [getPlayer]);

  /** Starts playing a WS-streamed utterance. Must be called synchronously
   * from the turn_result handler: the server sends the tts_chunk messages
   * right behind it, and a listener attached any later could miss one. */
  const startWsSpeech = useCallback((ws: WebSocket, turnId: string, streamedLlm = false): Promise<SpeechOutcome> => {
    const player = getPlayer();
    const requestedAt = Date.now();
    const speechEndAt = speechEndAtRef.current;
    const sttMs = lastSttMsRef.current;
    const done = player.begin(120000, () => {
      // Real first sound at the speakers -> report to the server log.
      if (ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      ws.send(JSON.stringify({
        type: "voice_metrics",
        turn_id: turnId,
        candidate_stop_to_first_audio_ms: speechEndAt ? now - speechEndAt : null,
        next_turn_to_first_audio_ms: now - requestedAt,
        stt_ms: sttMs,
      }));
    });
    currentTurnIdRef.current = turnId;
    // Streamed LLM: stay in "thinking" until the first sentence's audio
    // arrives — the model may still be composing it.
    if (streamedLlm) setLiveCaption("");
    else setPhase("speaking");
    const onMessage = (evt: MessageEvent) => {
      if (typeof evt.data !== "string") return;
      let msg: { type?: string; turn_id?: string; audio_base64?: string; text?: string };
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.turn_id !== turnId) return;
      if (msg.type === "tts_chunk" && msg.audio_base64) {
        if (streamedLlm) {
          setPhase("speaking");
          if (msg.text) setLiveCaption((c) => (c ? `${c} ${msg.text}` : msg.text!));
        }
        player.push(base64ToArrayBuffer(msg.audio_base64));
      } else if (msg.type === "tts_end") {
        player.finish();
      }
    };
    const onClose = () => player.finish();
    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    void done.then((outcome) => {
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      if (outcome === "completed" && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "voice_metrics", turn_id: turnId, full_response_ms: Date.now() - requestedAt }));
      }
      if (currentTurnIdRef.current === turnId) currentTurnIdRef.current = null;
    });
    return done;
  }, [getPlayer]);

  /** Stops the interviewer mid-sentence: local playback now, and the server
   * stops synthesizing the rest of the current line. */
  const interruptSpeech = useCallback(() => {
    playerRef.current?.stop();
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && currentTurnIdRef.current) {
      ws.send(JSON.stringify({ type: "barge_in", timestamp: Date.now(), turn_id: currentTurnIdRef.current }));
    }
    currentTurnIdRef.current = null;
  }, []);

  const runEvaluation = useCallback(
    async (history: TranscriptTurn[]) => {
      setPhase("evaluating");
      try {
        const res = await fetchWithRetry(
          `${API_URL}/api/v1/interview/evaluate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getLlmopsHeaders(), ...getAuthHeaders() },
            body: JSON.stringify({
              history: history.map((t) => ({ role: t.role, text: t.text })),
              role_title: roleTitle || DEFAULT_ROLE,
              session_id: sessionId,
              jd_text: jdText || undefined,
              resume_skills: resumeSkillsRef.current,
              candidate_name: candidateName || undefined,
              email: email || undefined,
              time_taken_sec: startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : null,
              question_count: history.filter((t) => t.role === "candidate").length,
              proctor_flags_count: proctoring.flags.length,
              integrity_score: proctoring.integrityScore,
            }),
          },
          1,
          45000,
        );
        if (!res.ok) throw new Error(`Evaluation request failed (${res.status})`);
        setEvaluation(await res.json());
      } catch (err) {
        console.error("Evaluation failed", err);
        setErrorMessage(
          err instanceof DOMException && err.name === "AbortError"
            ? "The final report took too long to generate. The transcript above is still complete — please try reloading in a moment."
            : "Could not generate the final evaluation. The transcript above is still complete.",
        );
      }
      setPhase("complete");
    },
    [roleTitle, jdText, sessionId, candidateName, email, proctoring.flags.length, proctoring.integrityScore],
  );

  /** Asks the LLM for the interviewer's next line with WebSocket streaming acceleration */
  const advanceToNextQuestion = useCallback(
    async (history: TranscriptTurn[]) => {
      if (endedRef.current) return;
      setPhase("thinking");
      try {
        let data: { question: string; is_final: boolean } | null = null;
        wsSpeechRef.current = null;

        // 1. Try ultra-low latency WebSocket pipeline
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            data = await new Promise((resolve, reject) => {
              const ws = wsRef.current!;
              const timer = setTimeout(() => {
                ws.removeEventListener("message", handler);
                reject(new Error("WebSocket timeout"));
              }, 14000);
              const handler = (evt: MessageEvent) => {
                if (typeof evt.data !== "string") return;
                try {
                  const msg = JSON.parse(evt.data);
                  // Streamed LLM: audio starts on turn_start, before the
                  // full text exists. Attached synchronously here so no
                  // tts_chunk that follows can be missed.
                  if (msg.type === "turn_start" && msg.turn_id && !endedRef.current) {
                    wsSpeechRef.current = startWsSpeech(ws, msg.turn_id, true);
                  } else if (msg.type === "turn_result") {
                    clearTimeout(timer);
                    ws.removeEventListener("message", handler);
                    if (!msg.streamed && msg.audio_stream && msg.turn_id && !endedRef.current) {
                      wsSpeechRef.current = startWsSpeech(ws, msg.turn_id);
                    }
                    resolve(msg);
                  }
                } catch {}
              };
              ws.addEventListener("message", handler);
              ws.send(JSON.stringify({
                type: "next_turn",
                history: history.map((t) => ({ role: t.role, text: t.text })),
                role_title: roleTitle || DEFAULT_ROLE,
                jd_text: jdText || undefined,
                resume_context: resumeContextRef.current || undefined,
                max_turns: MAX_CANDIDATE_TURNS,
                stream_llm: true,
                client_timing: {
                  stt_ms: lastSttMsRef.current,
                  since_speech_end_ms: speechEndAtRef.current ? Date.now() - speechEndAtRef.current : null,
                },
              }));
            });
          } catch (wsErr) {
            console.warn("[WebSocket Turn Fallback to HTTP]", wsErr);
            // A streamed reply may already be playing — stop it so the HTTP
            // fallback's line can't overlap it.
            if (wsSpeechRef.current) {
              interruptSpeech();
              wsSpeechRef.current = null;
            }
          }
        }

        // 2. HTTP Fallback
        if (!data) {
          const res = await fetchWithRetry(
            `${API_URL}/api/v1/interview/turn`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json", ...getAuthHeaders() },
              body: JSON.stringify({
                history: history.map((t) => ({ role: t.role, text: t.text })),
                role_title: roleTitle || DEFAULT_ROLE,
                jd_text: jdText || undefined,
                resume_context: resumeContextRef.current || undefined,
                max_turns: MAX_CANDIDATE_TURNS,
                session_id: sessionId,
              }),
            },
            1,
            25000,
          );
          if (!res.ok) throw new Error(`Interview turn request failed (${res.status})`);
          data = (await res.json()) as { question: string; is_final: boolean };
        }
        if (endedRef.current) {
          playerRef.current?.stop();
          return;
        }

        // Interrupted before the model wrote anything: nothing was said, and
        // the server recorded no question — keep histories in step.
        const turn = data.question ? addTurn("interviewer", data.question) : null;
        const streamed = wsSpeechRef.current;
        wsSpeechRef.current = null;
        if (streamed) await streamed;
        else if (data.question) await speak(data.question);
        setLiveCaption("");
        if (endedRef.current) return;

        if (data.is_final && turn) {
          await runEvaluation([...history, turn]);
        } else {
          setPhase("listening");
        }
      } catch (err) {
        if (endedRef.current) return;
        console.error("Failed to get next interview turn", err);
        setErrorMessage("Could not reach the interview agent for the next question — please try answering again.");
        setPhase("listening");
      }
    },
    [roleTitle, jdText, sessionId, addTurn, speak, startWsSpeech, interruptSpeech, runEvaluation],
  );

  /** Opt-in screen recording — a separate getDisplayMedia() stream alongside
   * the webcam/mic ones, following useProctoring.ts's pattern: its own
   * try/catch, non-fatal if declined or unsupported so the interview itself
   * is never blocked by it. Recorded chunks stay in memory only; nothing is
   * ever sent to the backend. */
  const startScreenRecording = useCallback(async () => {
    setScreenRecordingError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setScreenRecordingError("Screen recording isn't supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      screenChunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      screenRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) screenChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        setScreenRecordingBlob(new Blob(screenChunksRef.current, { type: "video/webm" }));
        setIsRecordingScreen(false);
      };
      // The candidate can stop sharing from the browser's own "Stop sharing"
      // control at any time — treat that the same as our own stop button
      // (finalize whatever was captured) rather than leaving state stuck.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (screenRecorderRef.current && screenRecorderRef.current.state !== "inactive") {
          screenRecorderRef.current.stop();
        }
      });

      recorder.start();
      setIsRecordingScreen(true);
    } catch (err) {
      console.error("Screen recording failed to start", err);
      setScreenRecordingError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Screen-share permission was denied — continuing without a recording."
          : "Could not start screen recording — continuing without one.",
      );
    }
  }, []);

  const stopScreenRecording = useCallback(() => {
    if (screenRecorderRef.current && screenRecorderRef.current.state !== "inactive") {
      screenRecorderRef.current.stop();
    }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
  }, []);

  const saveScreenRecording = useCallback(() => {
    if (!screenRecordingBlob) return;
    const url = URL.createObjectURL(screenRecordingBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [screenRecordingBlob]);

  // Finalize the screen recording as soon as the interview reaches
  // "complete" so a Save button can appear immediately, without requiring
  // the candidate to also click "End Session" first.
  useEffect(() => {
    if (phase === "complete") stopScreenRecording();
  }, [phase, stopScreenRecording]);

  /** Opt-in behavioral-analysis recording. Only meaningful when sessionId is
   * set (a bare local demo with no ScreeningSession row has nowhere to
   * upload to) — startInterview() below only calls this when both
   * behavioralRecordingConsent and sessionId are true. Non-fatal on
   * failure, matching startScreenRecording's own pattern: a declined/
   * unsupported camera+mic request degrades to "no behavioral analysis this
   * session," never to a blocked interview. */
  const startBehavioralRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: true,
      });
      avStreamRef.current = stream;
      avChunksRef.current = [];

      const mimeType = ["video/webm;codecs=vp8,opus", "video/webm"].find(
        (t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t),
      ) || "video/webm";
      avMimeTypeRef.current = mimeType;

      const recorder = new MediaRecorder(stream, { mimeType });
      avRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) avChunksRef.current.push(e.data);
      };
      // 2s timeslices: without one, some browsers only fire ondataavailable
      // on stop(), so a tab crash mid-interview would lose the entire
      // recording instead of just the last couple of seconds.
      recorder.start(2000);
    } catch (err) {
      console.warn("[Behavioral recording] could not start", err);
    }
  }, []);

  /** Stops the recorder, waits for the final chunk, and uploads the whole
   * interview recording for OCEAN-AI analysis. Fire-and-forget with respect
   * to the interview flow itself — the evaluation report above already
   * rendered by the time this resolves either way (see
   * handleEndInterviewAndEvaluate), matching this feature's core rule: a
   * failed/slow upload must never block or fail the interview. */
  const stopBehavioralRecordingAndUpload = useCallback(async () => {
    const recorder = avRecorderRef.current;
    const stream = avStreamRef.current;
    if (!recorder || !sessionId) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }

    if (recorder.state === "inactive") {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;
    stream?.getTracks().forEach((t) => t.stop());
    avStreamRef.current = null;

    if (avChunksRef.current.length === 0) return;

    try {
      const blob = new Blob(avChunksRef.current, { type: avMimeTypeRef.current });
      const formData = new FormData();
      formData.append("file", blob, `${sessionId}.webm`);
      const res = await fetchWithRetry(
        `${API_URL}/api/v1/interview/${sessionId}/recording`,
        { method: "POST", body: formData },
        1,
        120000,
      );
      if (!res.ok) console.error("[Behavioral recording] upload rejected", res.status);
    } catch (err) {
      console.error("[Behavioral recording] upload failed", err);
    }
  }, [sessionId]);

  /** Speaker monitor capture: the candidate's mic as 16 kHz mono int16 PCM,
   * sent as binary frames (~250 ms each) on the interview WebSocket. Its
   * own getUserMedia stream (echo cancellation on), separate from the
   * per-answer recorder and from proctoring. Non-fatal: if the browser
   * refuses, the interview simply runs without audio monitoring. */
  const startSpeakerCapture = useCallback(async () => {
    if (speakerAudioRef.current || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      const ctx = new AudioContext({ sampleRate: 16000 });
      const worklet = `class PcmCapture extends AudioWorkletProcessor {
        process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
      }
      registerProcessor("pcm-capture", PcmCapture);`;
      const url = URL.createObjectURL(new Blob([worklet], { type: "application/javascript" }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      const FRAME = 4000; // 250 ms at 16 kHz
      let pending = new Float32Array(0);
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const merged = new Float32Array(pending.length + e.data.length);
        merged.set(pending);
        merged.set(e.data, pending.length);
        pending = merged;
        while (pending.length >= FRAME) {
          const chunk = pending.subarray(0, FRAME);
          pending = pending.slice(FRAME);
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) continue;
          const pcm = new Int16Array(FRAME);
          for (let i = 0; i < FRAME; i++) pcm[i] = Math.max(-1, Math.min(1, chunk[i])) * 0x7fff;
          ws.send(pcm.buffer);
        }
      };
      ctx.createMediaStreamSource(stream).connect(node);
      speakerAudioRef.current = { ctx, stream, node };
    } catch (err) {
      console.warn("[Speaker monitor] capture unavailable", err);
      setVoiceCheck((prev) => ({ ...prev, status: "unavailable" }));
    }
  }, []);

  const stopSpeakerCapture = useCallback(() => {
    const cap = speakerAudioRef.current;
    speakerAudioRef.current = null;
    if (!cap) return;
    cap.node.port.onmessage = null;
    cap.stream.getTracks().forEach((t) => t.stop());
    cap.ctx.close().catch(() => {});
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "audio_stream_stop" }));
  }, []);

  useEffect(() => {
    if (phase === "complete") stopSpeakerCapture();
  }, [phase, stopSpeakerCapture]);

  const startInterview = useCallback(async () => {
    if (!resumeFile || !roleTitle.trim()) return;
    // Still inside the Start click's user gesture: browsers only let audio
    // start from one, and everything after this point is behind an await.
    const player = getPlayer();
    player.unlock();
    setSpeechAnalyser(player.analyser);
    endedRef.current = false;
    setConfirmEndOpen(false);
    setPhase("starting");
    setErrorMessage(null);
    setTranscript([]);
    setEvaluation(null);
    resumeSkillsRef.current = [];
    emptyAnswerStreakRef.current = 0;
    startedAtRef.current = Date.now();
    setScreenRecordingBlob(null);
    const monitorVoice = Boolean(sessionId && speakerMonitorConsent);
    speakerConsentRef.current = monitorVoice;
    setVoiceCheck(monitorVoice ? { ...INITIAL_VOICE_CHECK, status: "starting" } : INITIAL_VOICE_CHECK);
    await startProctoring();
    if (screenRecordingEnabled) await startScreenRecording();
    if (behavioralRecordingConsent && sessionId) await startBehavioralRecording();
    if (monitorVoice) await startSpeakerCapture();
    try {
      const formData = new FormData();
      formData.append("resume", resumeFile);
      formData.append("role_title", roleTitle || DEFAULT_ROLE);
      formData.append("jd_text", jdText || "");
      if (sessionId) formData.append("session_id", sessionId);

      // 60 s: this call makes two sequential LLM calls (resume profile +
      // question set); measured 17-19 s EACH on 2026-09-30 (incl. a 2-5 s
      // Langfuse prompt lookup that 404s and is refetched every time), so
      // 30 s aborted it and the interview could not start at all.
      const res = await fetchWithRetry(`${API_URL}/api/v1/screening/start`, { method: "POST", headers: getAuthHeaders(), body: formData }, 1, 60000);
      if (!res.ok) throw new Error(`Screening start failed (${res.status})`);
      const data = (await res.json()) as ScreeningStartResponse;

      if (!data.questions || data.questions.length === 0) throw new Error("No questions returned");

      setCandidateName(data.resume_profile?.candidate_name || null);
      resumeContextRef.current = data.resume_profile ? buildResumeContext(data.resume_profile) : "";
      resumeSkillsRef.current = data.resume_profile?.skills || [];

      if (endedRef.current) return;
      const greeting = data.questions[0];
      addTurn("interviewer", greeting.text);
      await speak(greeting.text);
      if (endedRef.current) return;
      setPhase("listening");
    } catch (err) {
      if (endedRef.current) return;
      console.error("Failed to start interview", err);
      setErrorMessage("Could not reach the interview agent. Check that the backend is running.");
      setPhase("error");
    }
  }, [
    resumeFile, roleTitle, jdText, sessionId, startProctoring, addTurn, speak, getPlayer,
    screenRecordingEnabled, startScreenRecording, behavioralRecordingConsent, startBehavioralRecording,
    speakerMonitorConsent, startSpeakerCapture,
  ]);

  /** Hands-free turn: opens the mic the instant we're "listening" and lets
   * voice-activity detection decide when the answer is done. */
  const startAutoRecording = useCallback(async () => {
    if (phase !== "listening") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Silence-triggered stops set this already; timeouts end "now".
        speechEndAtRef.current ??= Date.now();
        stream.getTracks().forEach((t) => t.stop());
        stopVadLoop();
        setPhase("transcribing");
        try {
          const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
          const formData = new FormData();
          formData.append("file", blob, "answer.webm");
          const sttStartedAt = Date.now();
          const res = await fetchWithRetry(`${API_URL}/api/v1/transcribe`, { method: "POST", body: formData }, 1, 25000);
          if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
          const data = await res.json();
          lastSttMsRef.current = Date.now() - sttStartedAt;
          if (endedRef.current) return;
          const candidateText: string = (data.transcript || "").trim();

          if (!candidateText) {
            const streak = (emptyAnswerStreakRef.current += 1);
            if (streak >= 2) {
              emptyAnswerStreakRef.current = 0;
              const nextHistory = [...transcript, addTurn("candidate", "(no response detected)")];
              setPhase("thinking");
              await speak("No worries, let's move on.");
              await advanceToNextQuestion(nextHistory);
            } else {
              setPhase("thinking");
              await speak("Sorry, I didn't catch that — could you please repeat your answer?");
              if (!endedRef.current) setPhase("listening");
            }
            return;
          }

          emptyAnswerStreakRef.current = 0;
          const nextHistory = [...transcript, addTurn("candidate", candidateText)];
          setPhase("thinking");
          await advanceToNextQuestion(nextHistory);
        } catch (err) {
          if (endedRef.current) return;
          console.error("Answer processing failed", err);
          setErrorMessage("Something went wrong processing that answer — listening again…");
          setPhase("listening");
        }
      };

      speechEndAtRef.current = null;
      lastSttMsRef.current = null;
      recorder.start();
      setPhase("recording");
      startVadLoop(stream);
    } catch (err) {
      console.error("Mic access failed", err);
      setErrorMessage("Microphone permission was denied. Allow mic access to answer.");
    }
  }, [phase, transcript, addTurn, speak, advanceToNextQuestion, startVadLoop, stopVadLoop]);

  const startAutoRecordingRef = useRef<() => void>(() => {});
  useEffect(() => {
    startAutoRecordingRef.current = startAutoRecording;
  });
  useEffect(() => {
    if (phase === "listening") startAutoRecordingRef.current();
  }, [phase]);

  const stopEverything = useCallback(() => {
    stopProctoring();
    stopVadLoop();
    stopScreenRecording();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    // Abandoned interview (Exit, not End & Get Report) — nothing worth
    // analyzing, so the behavioral recording is just discarded, not uploaded.
    if (avRecorderRef.current && avRecorderRef.current.state !== "inactive") {
      avRecorderRef.current.onstop = null;
      avRecorderRef.current.stop();
    }
    avStreamRef.current?.getTracks().forEach((t) => t.stop());
    stopSpeakerCapture();
    endedRef.current = true;
    interruptSpeech();
    setConfirmEndOpen(false);
    setPhase("setup");
  }, [stopProctoring, stopVadLoop, stopScreenRecording, stopSpeakerCapture, interruptSpeech]);

  /** End the call and go straight to the report. Anything still in flight
   * (a question being generated or spoken, an answer being transcribed) is
   * abandoned via endedRef rather than awaited. */
  const handleEndInterviewAndEvaluate = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    setConfirmEndOpen(false);
    interruptSpeech();
    stopProctoring();
    stopVadLoop();
    stopScreenRecording();
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());

    // Not awaited: the upload (and the analysis it queues) must never delay
    // the evaluation report the candidate/HR is waiting on. A failed upload
    // is silent to the candidate by design; HR then simply has no Behavioral
    // Analysis section for this interview.
    void stopBehavioralRecordingAndUpload();
    stopSpeakerCapture();

    await runEvaluation(transcript);
  }, [
    stopProctoring, stopVadLoop, stopScreenRecording, runEvaluation, transcript,
    stopBehavioralRecordingAndUpload, stopSpeakerCapture, interruptSpeech,
  ]);

  // Barge-in monitor: only while the interviewer is speaking. Its own mic
  // stream (echo cancellation on) — the answer recorder isn't open yet then.
  useEffect(() => {
    if (!BARGE_IN_ENABLED || phase !== "speaking" || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let raf: number | null = null;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        });
        if (cancelled) return;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let loudMs = 0;
        let last = performance.now();
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const now = performance.now();
          const dt = Math.min(100, now - last);
          last = now;
          loudMs = Math.sqrt(sum / data.length) > BARGE_IN_RMS_THRESHOLD ? loudMs + dt : Math.max(0, loudMs - dt / 2);
          if (loudMs >= BARGE_IN_TRIGGER_MS) {
            // Stopping playback resolves the pending speak(); the flow
            // then moves to "listening" and records the candidate.
            interruptSpeech();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        // No mic permission here just means no barge-in; never fatal.
      }
    })();
    return () => {
      cancelled = true;
      if (raf !== null) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
    };
  }, [phase, interruptSpeech]);

  const handleResumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) {
      setResumeFile(null);
      return;
    }
    const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!looksLikePdf) {
      setResumeError("Only PDF resumes are supported.");
      setResumeFile(null);
      e.target.value = "";
      return;
    }
    setResumeError(null);
    setResumeFile(file);
  }, []);

  const submitInvite = useCallback(async () => {
    if (!isValidEmail(inviteEmail)) {
      setInviteEmailError("Enter a valid email address.");
      return;
    }
    if (!roleTitle.trim()) {
      setInviteEmailError("Set a role title first.");
      return;
    }
    setInviteEmailError(null);
    setInviteSending(true);
    try {
      const res = await fetchWithRetry(`${API_URL}/api/v1/screening/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ email: inviteEmail, role_title: roleTitle, jd_text: jdText || null }),
      });
      const data = await res.json();
      setToast({
        id: `${Date.now()}`,
        variant: data.status === "sent" ? "success" : "error",
        message: data.message || (data.status === "sent" ? "Invite sent." : "Could not send the invite."),
      });
      if (data.status === "sent") {
        setInviteOpen(false);
        setInviteEmail("");
      }
    } catch (err) {
      console.error("Invite request failed", err);
      setToast({ id: `${Date.now()}`, variant: "error", message: "Could not reach the server to send the invite." });
    } finally {
      setInviteSending(false);
    }
  }, [inviteEmail, roleTitle, jdText]);

  const isLive = proctoring.status === "live";
  const canEditSetup = phase === "setup";
  const canStart = Boolean(roleTitle.trim() && resumeFile);
  const candidateTurnsSoFar = transcript.filter((t) => t.role === "candidate").length;

  if (canEditSetup) {
    return (
      <div className="mx-auto w-full overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-xl">
        <div className="p-4 sm:p-5 flex items-center justify-between border-b border-zinc-100 flex-wrap gap-3">
          <div className="flex items-center gap-2 text-zinc-500">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">A</span>
            <span className="text-sm font-bold text-zinc-800">AgenticFlow AI · Screening Agent</span>
          </div>
          <div className="flex items-center gap-2">
            {!roleFieldsLocked && (
              <button
                onClick={() => setInviteOpen((v) => !v)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                {inviteOpen ? "Cancel" : "Invite Candidate"}
              </button>
            )}
            <button
              onClick={startInterview}
              disabled={!canStart}
              className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              Start Interview
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {inviteOpen && !roleFieldsLocked && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-zinc-100 bg-blue-50/40"
            >
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-end gap-3">
                <label className="block flex-1 w-full">
                  <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">Candidate email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      setInviteEmailError(null);
                    }}
                    placeholder="candidate@example.com"
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white"
                  />
                  {inviteEmailError && <span className="mt-1 block text-[11px] text-red-500">{inviteEmailError}</span>}
                </label>
                <button
                  onClick={submitInvite}
                  disabled={inviteSending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {inviteSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  Send Invite
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid sm:grid-cols-2 gap-4 p-4 sm:p-5 border-b border-zinc-100 bg-zinc-50/60">
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">
              Role being screened for <span className="text-red-500">*</span>
            </span>
            <input
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder={DEFAULT_ROLE}
              disabled={roleFieldsLocked}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white disabled:bg-zinc-100 disabled:text-zinc-500"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">
              Job description (optional — makes questions role-specific)
            </span>
            <textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste a JD, or leave blank for a general screen"
              rows={3}
              disabled={roleFieldsLocked}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white resize-none disabled:bg-zinc-100 disabled:text-zinc-500"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[11px] font-semibold text-zinc-500 mb-1 block">
              Resume (PDF) <span className="text-red-500">*</span>
            </span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleResumeChange}
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 bg-white file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-blue-700"
            />
            {resumeFile && <span className="mt-1 block text-[11px] text-emerald-600">{resumeFile.name} selected</span>}
            {resumeError && <span className="mt-1 block text-[11px] text-red-500">{resumeError}</span>}
          </label>
        </div>

        {errorMessage && (
          <div className="mx-4 sm:mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {errorMessage}
          </div>
        )}

        <div className="p-4 sm:p-5 flex flex-col gap-3">
          <p className="text-xs text-zinc-400">
            Your camera and microphone will be used for a live, proctored interview once you start.
          </p>
          <label className="flex items-center gap-2 text-xs font-medium text-zinc-600 cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={screenRecordingEnabled}
              onChange={(e) => setScreenRecordingEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-400"
            />
            <ScreenShare className="w-3.5 h-3.5 text-zinc-400" />
            Record my screen during the interview (optional — saved to your device only, never uploaded)
          </label>
          {screenRecordingError && <span className="text-[11px] text-amber-600">{screenRecordingError}</span>}
          {screenRecordingBlob && (
            <button
              onClick={saveScreenRecording}
              className="inline-flex items-center gap-1.5 w-fit rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
            >
              <Download className="w-3.5 h-3.5" /> Save last recording
            </button>
          )}
          {sessionId && (
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
              <label className="flex items-start gap-2 text-xs font-medium text-zinc-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={behavioralRecordingConsent}
                  onChange={(e) => setBehavioralRecordingConsent(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-400"
                />
                <span className="flex items-start gap-1.5">
                  <Brain className="w-3.5 h-3.5 text-indigo-500 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold text-zinc-700">
                      Allow AI-based behavioral/personality analysis (optional)
                    </span>
                    <span className="block text-[11px] font-normal text-zinc-500 mt-0.5">
                      Records your camera + microphone for the full interview and analyzes it with
                      OCEAN-AI to produce supplementary behavioral signals (openness, conscientiousness,
                      extraversion, agreeableness, non-neuroticism) for the hiring team. This is never
                      used to automatically reject or hire you, and is only visible to authorized HR
                      staff. Leave unchecked to skip this — it has no effect on your interview score.
                    </span>
                  </span>
                </span>
              </label>
            </div>
          )}
          {sessionId && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3">
              <label className="flex items-start gap-2 text-xs font-medium text-zinc-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={speakerMonitorConsent}
                  onChange={(e) => setSpeakerMonitorConsent(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-400"
                />
                <span className="flex items-start gap-1.5">
                  <Mic className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />
                  <span>
                    <span className="block font-semibold text-zinc-700">Allow a voice check during the interview (optional)</span>
                    <span className="block text-[11px] font-normal text-zinc-500 mt-0.5">
                      Your first answers are used to learn what your voice sounds like; later answers are checked for
                      other voices on your microphone. Your voice profile is kept only for this interview and is never
                      shown to anyone. The hiring team sees neutral notes such as &ldquo;additional speaker detected&rdquo;.
                    </span>
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        <Toast toast={toast} onDismiss={() => setToast(null)} />
      </div>
    );
  }

  if (phase === "evaluating") {
    return <EvaluatingScreen candidateView={candidateView} />;
  }

  if (candidateView && phase === "complete") {
    return (
      <div className="mx-auto w-full max-w-xl py-16 px-4">
        {evaluation ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-600" />
            <h1 className="text-xl font-semibold text-zinc-900">Your interview has been submitted</h1>
            <p className="mt-2 text-sm text-zinc-500">
              Thank you for your time. Your responses were recorded and sent to the hiring team for {roleTitle || DEFAULT_ROLE}.
              They will be in touch about next steps.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
            <h1 className="text-lg font-semibold text-amber-800">Your interview couldn&rsquo;t be submitted yet</h1>
            <p className="mt-2 text-sm text-amber-700">
              {errorMessage || "The final submission failed."} Your answers so far are saved on our side.
            </p>
            <button
              onClick={() => { setErrorMessage(null); void runEvaluation(transcript); }}
              className="mt-4 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Retry submission
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "complete" && !evaluation) {
    return (
      <div className="mx-auto w-full max-w-xl py-16 px-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-600" />
          <h1 className="text-lg font-semibold text-amber-900">The report couldn&rsquo;t be generated</h1>
          <p className="mt-2 text-sm text-amber-800">
            {errorMessage || "The evaluation request failed."} The interview transcript is kept, so you can retry.
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <button
              onClick={() => { setErrorMessage(null); void runEvaluation(transcript); }}
              className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              <RotateCcw className="h-4 w-4" /> Retry report
            </button>
            <button
              onClick={() => setPhase("setup")}
              className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Start new screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "complete" && evaluation) {
    return (
      <div ref={reportRef} className="mx-auto w-full max-w-4xl scroll-mt-20 py-10 px-4 space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-200 pb-5 flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-700 uppercase">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Interview Complete · Candidate Assessment Report</span>
            </div>
            <h1 className="text-2xl font-extrabold text-zinc-900 mt-1">
              Evaluation for {candidateName || "candidate"}
            </h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              Role: {roleTitle || DEFAULT_ROLE} · Duration {formatClock(elapsedMs)} · {candidateTurnsSoFar} answer
              {candidateTurnsSoFar === 1 ? "" : "s"} · Generated at {new Date().toLocaleTimeString()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {screenRecordingBlob && (
              <button
                onClick={saveScreenRecording}
                className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" /> Download Recording
              </button>
            )}
            <button
              onClick={() => setPhase("setup")}
              className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
            >
              Start New Screen
            </button>
          </div>
        </div>

        <InterviewReport evaluation={evaluation} sessionId={sessionId} />
      </div>
    );
  }

  const aiSpeaking = phase === "speaking";
  const candidateSpeaking = phase === "recording";
  const lastQuestion = [...transcript].reverse().find((t) => t.role === "interviewer");
  const questionNumber = Math.min(candidateTurnsSoFar + 1, MAX_CANDIDATE_TURNS);
  const aiStatus =
    phase === "speaking" ? "Speaking"
    : phase === "thinking" || phase === "transcribing" ? "Thinking"
    : phase === "listening" || phase === "recording" ? "Listening"
    : phase === "starting" ? "Joining"
    : "Idle";

  // Portaled to <body>: an ancestor in the product layout creates a
  // containing block, which pinned this "fixed" overlay below the site header
  // (seen in live E2E screenshots) instead of covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col bg-[#0a0c11] text-white">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xs font-bold">
            A
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{roleTitle || DEFAULT_ROLE} · AI Interview</div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              {transcript.length > 0 ? (
                <>
                  <span>Question {questionNumber} of {MAX_CANDIDATE_TURNS}</span>
                  <span className="hidden sm:flex h-1 w-24 overflow-hidden rounded-full bg-white/10">
                    <span
                      className="h-full rounded-full bg-blue-400 transition-all duration-500"
                      style={{ width: `${(candidateTurnsSoFar / MAX_CANDIDATE_TURNS) * 100}%` }}
                    />
                  </span>
                </>
              ) : (
                <span>Connecting…</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1 font-mono text-xs text-zinc-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            {formatClock(elapsedMs)}
          </span>
          <span
            className={`hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
              isLive ? "bg-emerald-500/10 text-emerald-300" : "bg-white/[0.06] text-zinc-400"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" /> {isLive ? "Proctored" : "Proctoring off"}
          </span>
        </div>
      </header>

      {errorMessage && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-200 sm:mx-6">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {errorMessage}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        <main className="flex flex-col gap-3 p-3 sm:gap-4 sm:p-5 lg:min-h-0">
          {/* Stage: AI on the left, candidate on the right */}
          <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 lg:min-h-0 lg:flex-1">
            <section
              className={`relative flex min-h-[220px] flex-col items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 transition-shadow duration-300 ${
                aiSpeaking ? "ring-2 ring-sky-400/70 shadow-[0_0_48px_-10px_rgba(56,189,248,0.55)]" : "ring-1 ring-white/10"
              }`}
            >
              <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-blue-500/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-indigo-500/20 blur-3xl" />
              <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur">
                {aiStatus === "Thinking" || aiStatus === "Joining" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : aiStatus === "Speaking" ? (
                  <Volume2 className="h-3 w-3" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full ${aiStatus === "Listening" ? "bg-emerald-400" : "bg-zinc-400"}`} />
                )}
                {aiStatus}
              </span>

              <div className="relative">
                {aiSpeaking && (
                  <>
                    <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/20" />
                    <span className="absolute -inset-3 rounded-full ring-2 ring-sky-400/30" />
                  </>
                )}
                <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 shadow-xl shadow-blue-900/50 sm:h-32 sm:w-32">
                  <Sparkles className="h-10 w-10 text-white/95 sm:h-12 sm:w-12" />
                </div>
              </div>
              <div className="mt-5 h-10">
                <AgentWaveform analyser={speechAnalyser} active={aiSpeaking} />
              </div>

              <div className="absolute bottom-3 left-3 rounded-lg bg-black/40 px-2.5 py-1 text-xs font-medium backdrop-blur">
                {INTERVIEWER_NAME} <span className="text-zinc-400">· AI Interviewer</span>
              </div>
            </section>

            <section
              ref={videoContainerRef}
              className={`relative h-[260px] overflow-hidden rounded-3xl bg-zinc-900 md:h-auto md:min-h-[240px] transition-shadow duration-300 ${
                candidateSpeaking ? "ring-2 ring-emerald-400/70 shadow-[0_0_48px_-10px_rgba(52,211,153,0.5)]" : "ring-1 ring-white/10"
              }`}
            >
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover [transform:scaleX(-1)]" />
              {proctoring.status === "error" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/95 px-6 text-center text-amber-300">
                  <AlertTriangle className="h-9 w-9 opacity-80" />
                  <p className="max-w-[240px] text-xs font-medium">{proctoring.errorMessage}</p>
                  <p className="max-w-[240px] text-[11px] text-zinc-400">
                    BrewShield proctoring couldn&rsquo;t start, but the interview itself will continue normally.
                  </p>
                </div>
              )}
              {proctoring.status === "starting" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900/90 px-6 text-center text-zinc-300">
                  <Loader2 className="h-8 w-8 animate-spin opacity-70" />
                  <p className="text-xs">Requesting camera access…</p>
                </div>
              )}
              {isLive && <FaceOverlayCanvas containerRef={videoContainerRef} boxes={faceBoxes} />}
              <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
                {isLive && (
                  <span className="flex items-center gap-1 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-semibold">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE
                  </span>
                )}
                {isRecordingScreen && (
                  <span className="flex items-center gap-1 rounded-full bg-blue-600/90 px-2.5 py-1 text-[11px] font-semibold">
                    <ScreenShare className="h-3 w-3" /> Recording screen
                  </span>
                )}
              </div>
              {isLive && proctoring.activeAlert && (
                <div className="absolute inset-x-0 top-1/2 mx-auto flex w-fit -translate-y-1/2 animate-pulse items-center gap-1.5 rounded-lg bg-red-600/95 px-4 py-2 text-center text-sm font-semibold shadow-lg">
                  <AlertTriangle className="h-4 w-4 shrink-0" /> {proctoring.activeAlert}
                </div>
              )}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/40 px-2.5 py-1 text-xs font-medium backdrop-blur">
                {candidateName || "You"}
                {candidateSpeaking && (
                  <span className="flex h-3 items-end gap-0.5" aria-hidden>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="w-0.5 rounded-full bg-emerald-400 transition-all duration-100"
                        style={{ height: `${3 + Math.min(1, micLevel * (0.7 + i * 0.2)) * 9}px` }}
                      />
                    ))}
                  </span>
                )}
              </div>
            </section>
          </div>

          {/* Live caption of the current question */}
          <div className="shrink-0 rounded-2xl bg-white/[0.04] px-4 py-3 ring-1 ring-white/[0.08]">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">
              {INTERVIEWER_NAME} asked
            </div>
            <p className="line-clamp-3 text-sm leading-relaxed text-zinc-100 sm:text-[15px]">
              {liveCaption || lastQuestion?.text || "Your interviewer will greet you in a moment…"}
            </p>
          </div>

          {/* Controls */}
          <div className="flex shrink-0 flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <MicStatusIndicator phase={phase} micLevel={micLevel} hasHeardSpeech={hasHeardSpeech} />
            <div className="flex items-center gap-2">
              <button
                onClick={stopEverything}
                title="Leave without a report"
                className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white/[0.06] px-4 text-xs font-semibold text-zinc-300 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white"
              >
                <LogOut className="h-4 w-4" /> Leave
              </button>
              <button
                onClick={() => setConfirmEndOpen(true)}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-semibold shadow-lg shadow-red-900/40 transition hover:bg-red-500"
              >
                <PhoneOff className="h-4 w-4" /> End interview
              </button>
            </div>
          </div>
        </main>

        {/* Sidebar: transcript + integrity */}
        <aside className="flex flex-col gap-3 border-t border-white/[0.06] p-3 sm:p-5 lg:min-h-0 lg:border-l lg:border-t-0">
          <div className="flex h-[45vh] flex-col rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08] lg:h-auto lg:min-h-0 lg:flex-1">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              <MessageSquare className="h-3.5 w-3.5" /> Transcript
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-left text-[13px]">
              <AnimatePresence initial={false}>
                {transcript.map((turn) => (
                  <motion.div
                    key={turn.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex flex-col ${turn.role === "candidate" ? "items-end" : "items-start"}`}
                  >
                    <span className={`mb-0.5 text-[10px] font-semibold ${turn.role === "candidate" ? "text-emerald-300" : "text-sky-300"}`}>
                      {turn.role === "candidate" ? "You" : INTERVIEWER_NAME}
                    </span>
                    <div
                      className={`max-w-[92%] rounded-2xl px-3 py-2 leading-relaxed ${
                        turn.role === "candidate"
                          ? "rounded-tr-sm bg-emerald-500/10 text-emerald-50"
                          : "rounded-tl-sm bg-sky-500/10 text-sky-50"
                      }`}
                    >
                      {turn.text}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={transcriptEndRef} />
            </div>
          </div>
          <BrewShieldPanel state={proctoring} voiceCheck={voiceCheck} />
        </aside>
      </div>

      <AnimatePresence>
        {confirmEndOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[1010] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setConfirmEndOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              className="w-full max-w-sm rounded-2xl bg-zinc-900 p-6 text-center ring-1 ring-white/10"
            >
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-600/15">
                <PhoneOff className="h-5 w-5 text-red-400" />
              </span>
              <h2 className="text-base font-semibold">End the interview?</h2>
              <p className="mt-1.5 text-sm text-zinc-400">
                {candidateView
                  ? "Your answers so far will be submitted to the hiring team."
                  : `The report will be generated from the ${candidateTurnsSoFar} answer${candidateTurnsSoFar === 1 ? "" : "s"} given so far.`}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setConfirmEndOpen(false)}
                  className="flex-1 rounded-xl bg-white/[0.06] py-2.5 text-sm font-semibold text-zinc-200 ring-1 ring-white/10 hover:bg-white/10"
                >
                  Keep going
                </button>
                <button
                  onClick={() => void handleEndInterviewAndEvaluate()}
                  className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold hover:bg-red-500"
                >
                  {candidateView ? "End & submit" : "End & get report"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function EvaluatingScreen({ candidateView }: { candidateView: boolean }) {
  const [messageIndex, setMessageIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setMessageIndex((i) => (i + 1) % REPORT_GENERATING_MESSAGES.length), 2500);
    return () => window.clearInterval(id);
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-5 bg-[#0a0c11] px-6 text-center text-white">
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600">
          <Loader2 className="h-8 w-8 animate-spin" />
        </span>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Interview ended</div>
        <h1 className="mt-1 text-xl font-semibold">
          {candidateView ? "Submitting your interview…" : "Generating the interview report…"}
        </h1>
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={messageIndex}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="text-sm text-zinc-400"
        >
          {REPORT_GENERATING_MESSAGES[messageIndex]}
        </motion.p>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function formatClock(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const s = (totalSeconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

const IDLE_LEVELS = Array(16).fill(0.12);

/** Real amplitude bars from the speech player's AnalyserNode — every
 * interviewer chunk (WAV or MP3) plays through it, so this tracks the
 * actual voice rather than a canned CSS pulse. */
function AgentWaveform({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);

  useEffect(() => {
    if (!active || !analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      setLevels(IDLE_LEVELS.map((_, i) => {
        const idx = Math.floor((i / IDLE_LEVELS.length) * data.length * 0.8);
        return Math.max(0.12, Math.min(1, data[idx] / 255));
      }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setLevels(IDLE_LEVELS);
    };
  }, [analyser, active]);

  return (
    <div className="flex h-10 items-center gap-1" aria-hidden>
      {levels.map((lvl, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-sky-300/80 transition-all duration-100"
          style={{ height: `${6 + lvl * 34}px` }}
        />
      ))}
    </div>
  );
}

function MicStatusIndicator({
  phase,
  micLevel,
  hasHeardSpeech,
}: {
  phase: InterviewPhase;
  micLevel: number;
  hasHeardSpeech: boolean;
}) {
  const active = phase === "listening" || phase === "recording";
  const recording = phase === "recording";

  let label = "Waiting…";
  if (active && !recording) label = "Getting your mic ready…";
  if (recording) {
    label = hasHeardSpeech ? "Recording — pause when you're done" : "Listening — start speaking whenever you're ready";
  }

  return (
    <div
      className={`flex h-11 items-center justify-center gap-2.5 rounded-full border px-4 text-xs font-semibold transition-all sm:text-sm ${
        recording
          ? "bg-red-500/10 border-red-400/30 text-red-200"
          : active
          ? "bg-blue-500/10 border-blue-400/30 text-blue-200"
          : "bg-white/5 border-white/10 text-zinc-400"
      }`}
    >
      {recording ? (
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </span>
      ) : (
        <Mic className="w-4 h-4 shrink-0" />
      )}
      <span>{label}</span>
      {recording && (
        <span className="flex items-end gap-0.5 h-4 shrink-0" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-red-400 transition-all duration-100"
              style={{ height: `${4 + Math.min(1, micLevel * (0.6 + i * 0.15)) * 12}px` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

const REPORT_GENERATING_MESSAGES = [
  "Reviewing your answers…",
  "Scoring communication & relevance…",
  "Comparing skills against the role…",
  "Preparing your detailed report…",
];

function voiceCheckLabel(v: VoiceCheckState): string {
  if (v.status === "unavailable") return "Unavailable";
  if (v.status === "degraded") return "Temporarily unavailable";
  if (v.additionalSpeaker) return "Additional speaker detected";
  if (v.wasCleared) return "Audio monitoring normal";
  if (v.candidateVerified) return "Candidate voice verified";
  if (v.status === "starting") return "Starting…";
  return "Establishing voice reference…";
}

function BrewShieldPanel({ state, voiceCheck }: { state: ProctoringState; voiceCheck: VoiceCheckState }) {
  const isLive = state.status === "live";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3 overflow-y-auto flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-bold text-red-300">
          <ShieldCheck className="w-3.5 h-3.5" />
          BrewShield {isLive ? "Proctoring Live" : "Proctoring Idle"}
        </h3>
        {isLive && (
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
            Server-Verified
          </span>
        )}
      </div>
      <dl className="space-y-1 text-[11px] text-zinc-400">
        <Row label="Integrity Score" value={`${state.integrityScore}/100`} strong />
        <Row label="Flags raised" value={String(state.flags.length)} />
        <Row label="Faces in frame" value={String(state.faceCount)} />
        <Row label="Tab switches" value={String(state.tabSwitchCount)} />
        <Row label="Reading Saccades" value={state.isReading ? "Active Detection" : "Normal"} />
        <Row label="DevTools / Shortcuts" value={state.devtoolsCount > 0 ? `${state.devtoolsCount} Blocked` : "Active Guard"} />
        <Row label="Clipboard Guard" value={state.pasteCount > 0 ? `${state.pasteCount} Pastes Blocked` : "Active Guard"} />
        <Row label="Display Guard" value={state.isMultiScreen ? "Multi-Display Detected" : "Single Screen"} />
        {voiceCheck.status !== "off" && <Row label="Voice check" value={voiceCheckLabel(voiceCheck)} />}
      </dl>
      {voiceCheck.timeline.length > 0 && (
        <ul className="space-y-1 border-t border-white/10 pt-2">
          {voiceCheck.timeline.slice(0, 4).map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-[11px] text-zinc-300">
              <span>{e.label}</span>
              <span className="shrink-0 text-zinc-500">{new Date(e.at).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      )}
      {state.flags.length === 0 ? (
        <p className="text-[11px] text-zinc-500 mt-1">No violations detected. Session verified.</p>
      ) : (
        <ul className="space-y-1.5 mt-1">
          {state.flags.slice(0, 6).map((flag) => (
            <li key={flag.id} className="flex items-start gap-1.5 text-[11px]">
              <AlertTriangle className="w-3 h-3 mt-0.5 text-red-400 shrink-0" />
              <span className="text-zinc-300">
                {flag.message}
                <span className="ml-1 text-zinc-500">{new Date(flag.timestamp).toLocaleTimeString()}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt>{label}</dt>
      <dd className={strong ? "text-xs font-bold text-zinc-200" : "font-medium text-zinc-300"}>{value}</dd>
    </div>
  );
}

function FaceOverlayCanvas({
  containerRef,
  boxes,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  boxes: FaceBox[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const { clientWidth: w, clientHeight: h } = container;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    for (const box of boxes) {
      const drawX = (1 - box.x - box.width) * w;
      const drawY = box.y * h;
      ctx.strokeStyle = box.flagged ? "#ef4444" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, drawY, box.width * w, box.height * h);
    }
  }, [boxes, containerRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}
