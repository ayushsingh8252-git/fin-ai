import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { getApiBaseUrl } from "@/lib/apiConfig";

/**
 * Client-side interview proctoring: face presence / multi-face detection,
 * gaze (looking-away) detection, and tab-switch / focus-loss detection.
 *
 * Deliberately the "fastest POC stack": one MediaPipe FaceLandmarker model
 * (loaded once, from CDN, run fully in-browser) gives us both face count
 * and iris landmarks for gaze in a single detectForVideo() call per frame.
 * Tab-switch detection is plain DOM events, not ML — highest signal for
 * the least effort.
 */

// Self-hosted under /public — the CDN/GCS equivalents (jsdelivr, storage.googleapis.com)
// throw "Failed to fetch" in the browser whenever a firewall, ad-blocker, or corporate
// proxy blocks third-party hosts, which took proctoring down entirely. Same-origin
// static assets remove that failure mode.
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/mediapipe/models/face_landmarker.task";

const NO_FACE_GRACE_MS = 3000; // spec: flag "no face" only after >3s
const LOOKING_AWAY_GRACE_MS = 2500; // spec: flag "looking away" after >2-3s
const MULTI_FACE_DEBOUNCE_MS = 1500;
const RE_FLAG_INTERVAL_MS = 4000; // don't spam the same sustained flag every frame
const DETECT_FPS = 8;
// After this many detectForVideo() calls fail in a row (~1.25s at DETECT_FPS),
// stop retrying silently and surface a friendly error instead of spinning
// forever — a lost/never-created GL context (see hasWebGLSupport below) fails
// identically on every frame, not just the first.
const MAX_CONSECUTIVE_DETECT_FAILURES = 10;

// Ambient background noise: a sustained noise floor above this level (e.g. a
// TV, other conversations in the room) gets flagged after a grace period so
// a brief cough or door slam doesn't trip it.
const NOISE_RMS_THRESHOLD = 0.05;
const NOISE_SUSTAINED_MS = 4000;
// Cross-talk: while the AI interviewer is mid-question the candidate is
// expected to stay quiet — any voice-level sound during that window is a
// stronger cheating signal (someone talking over the agent / being coached)
// than generic ambient noise, so it uses a lower threshold and shorter grace.
const CROSS_TALK_RMS_THRESHOLD = 0.04;
const CROSS_TALK_SUSTAINED_MS = 1500;
const AUDIO_RE_FLAG_INTERVAL_MS = 6000;
const AUDIO_SAMPLE_INTERVAL_MS = 200;

export type FlagType =
  | "no_face"
  | "multi_face"
  | "looking_away"
  | "reading_detected"
  | "tab_switch"
  | "devtools_opened"
  | "paste_attempt"
  | "multi_screen"
  | "background_noise"
  | "cross_talk";

export interface ProctorFlag {
  id: string;
  type: FlagType;
  message: string;
  timestamp: number;
}

export type ProctoringStatus = "idle" | "starting" | "live" | "error";

export interface ProctoringState {
  status: ProctoringStatus;
  errorMessage: string | null;
  faceCount: number;
  isLookingAway: boolean;
  isReading: boolean;
  integrityScore: number;
  flags: ProctorFlag[];
  activeAlert: string | null;
  tabSwitchCount: number;
  devtoolsCount: number;
  pasteCount: number;
  isMultiScreen: boolean;
  elapsedMs: number;
}

const FLAG_PENALTY: Record<FlagType, number> = {
  no_face: 15,
  multi_face: 10,
  looking_away: 5,
  reading_detected: 10,
  tab_switch: 5,
  devtools_opened: 15,
  paste_attempt: 8,
  multi_screen: 10,
  background_noise: 5,
  cross_talk: 8,
};

const FLAG_LABEL: Record<FlagType, string> = {
  no_face: "No face detected",
  multi_face: "Multiple faces detected",
  looking_away: "Candidate looking away",
  reading_detected: "Reading / script scanning detected",
  tab_switch: "Tab switched / window lost focus",
  devtools_opened: "Developer tools / shortcut attempt blocked",
  paste_attempt: "Clipboard paste attempt blocked",
  multi_screen: "Secondary display detected",
  background_noise: "Sustained background noise detected",
  cross_talk: "Talking over the interviewer detected",
};

/** "speaking" = the AI interviewer is currently talking (candidate should be
 * quiet); "other" = any other phase (candidate is free to talk/make noise). */
export type InterviewAudioPhase = "speaking" | "other";

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

// MediaPipe's WASM runtime routes its own informational logs (e.g. "INFO:
// Created TensorFlow Lite XNNPACK delegate for CPU.") through console.error
// instead of console.info — harmless, but Next's dev overlay treats every
// console.error as a reportable error. Drop only lines that actually start
// with "INFO:"/"WARNING:" so real errors still surface normally.
let consolePatchedForMediapipe = false;
function silenceMediapipeInfoLogs() {
  if (consolePatchedForMediapipe || typeof window === "undefined") return;
  consolePatchedForMediapipe = true;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && /^(INFO|WARNING):/.test(args[0])) return;
    originalError(...args);
  };
}

// The GPU delegate needs a real WebGL context (MediaPipe calls
// emscripten_webgl_create_context() internally), which fails in plenty of
// ordinary environments — VMs, remote desktop sessions, hardware
// acceleration disabled, headless/software-rendered browsers. Worse, when
// it fails, MediaPipe logs "StartGraph failed" via console.error but still
// *resolves* createFromOptions with a landmarker whose graph never actually
// started, so the crash surfaces later and deeper — inside detectForVideo()
// — instead of a catchable rejection at setup time. CPU (XNNPACK) doesn't
// need a GPU context at all and is plenty fast at this hook's 8fps/1-model
// detection rate, so use it unconditionally rather than probing for GPU.
// The vision runtime creates a WebGL context for its internal image/texture
// handling regardless of the inference delegate (confirmed: the installed
// @mediapipe/tasks-vision bundle calls canvas.getContext("webgl"/"webgl2")
// unconditionally, not just under delegate: "GPU") — so an environment with
// no WebGL at all (hardware acceleration disabled, some VMs/headless
// browsers, browser flags) will fail the same way CPU delegate was meant to
// avoid, just deeper inside detectForVideo() instead of at setup. Checking
// this upfront lets start() fail fast with a friendly message rather than
// letting the first detection frame throw "Cannot read properties of
// undefined (reading 'activeTexture')".
function hasWebGLSupport(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function getLandmarker(): Promise<FaceLandmarker> {
  if (!landmarkerPromise) {
    silenceMediapipeInfoLogs();
    landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE).then((fileset) =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      }),
    );
  }
  return landmarkerPromise;
}

/** Landmark indices for the 478-point MediaPipe face mesh (iris included). */
const NOSE_TIP = 1;
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const LEFT_EYE_OUTER = 33;
const LEFT_EYE_INNER = 133;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;
const FOREHEAD = 10;
const CHIN = 152;

/**
 * Simplified gaze/head-pose heuristic (intentionally simple, per spec):
 * compares the nose tip's horizontal position against the eye-corner span,
 * and its vertical position against forehead/chin, to approximate whether
 * the candidate is looking straight at the camera. This is a head-pose
 * proxy for gaze, not true eye-tracking, but is cheap and robust for a POC.
 */
function isLookingAwayFromLandmarks(
  landmarks: FaceLandmarkerResult["faceLandmarks"][number],
): boolean {
  const nose = landmarks[NOSE_TIP];
  const leftOuter = landmarks[LEFT_EYE_OUTER];
  const rightOuter = landmarks[RIGHT_EYE_OUTER];
  const forehead = landmarks[FOREHEAD];
  const chin = landmarks[CHIN];
  if (!nose || !leftOuter || !rightOuter || !forehead || !chin) return false;

  const faceWidth = Math.abs(rightOuter.x - leftOuter.x);
  const faceHeight = Math.abs(chin.y - forehead.y);
  if (faceWidth < 1e-4 || faceHeight < 1e-4) return false;

  const horizontalRatio = (nose.x - leftOuter.x) / faceWidth;
  const verticalRatio = (nose.y - forehead.y) / faceHeight;

  const horizontalOff = horizontalRatio < 0.35 || horizontalRatio > 0.65;
  const verticalOff = verticalRatio < 0.35 || verticalRatio > 0.75;
  return horizontalOff || verticalOff;
}

/**
 * Calculates iris position ratio within the left eye horizontal span.
 * Used to detect repeated scanning saccades (reading off-screen answers/ChatGPT).
 */
function getIrisHorizontalRatio(
  landmarks: FaceLandmarkerResult["faceLandmarks"][number],
): number | null {
  const leftIris = landmarks[LEFT_IRIS];
  const leftInner = landmarks[LEFT_EYE_INNER];
  const leftOuter = landmarks[LEFT_EYE_OUTER];
  if (!leftIris || !leftInner || !leftOuter) return null;
  const eyeSpan = Math.abs(leftInner.x - leftOuter.x);
  if (eyeSpan < 1e-4) return null;
  return (leftIris.x - Math.min(leftInner.x, leftOuter.x)) / eyeSpan;
}

export interface FaceBox {
  x: number; // 0-1 normalized
  y: number;
  width: number;
  height: number;
  flagged: boolean;
}

export function useProctoring(sessionId?: string) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDetectAtRef = useRef(0);
  const consecutiveDetectFailuresRef = useRef(0);
  const noFaceSinceRef = useRef<number | null>(null);
  const lookingAwaySinceRef = useRef<number | null>(null);
  const lastMultiFaceFlagRef = useRef(0);
  const lastNoFaceFlagRef = useRef(0);
  const lastLookAwayFlagRef = useRef(0);
  const lastReadingFlagRef = useRef(0);
  const lastTabFlagRef = useRef(0);
  const lastDevToolsFlagRef = useRef(0);
  const lastPasteFlagRef = useRef(0);
  const lastMultiScreenFlagRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const mountedRef = useRef(true);

  // Saccade tracking buffer for reading detection
  const irisRatiosRef = useRef<{ time: number; ratio: number }[]>([]);

  // Ambient noise / cross-talk detection — a second, independent audio-only
  // stream from the video one (separate getUserMedia call), so camera and
  // mic permission/failure stay isolated from each other.
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const audioLoopIntervalRef = useRef<number | null>(null);
  const interviewAudioPhaseRef = useRef<InterviewAudioPhase>("other");
  const noiseSinceRef = useRef<number | null>(null);
  const crossTalkSinceRef = useRef<number | null>(null);
  const lastNoiseFlagRef = useRef(0);
  const lastCrossTalkFlagRef = useRef(0);

  const [state, setState] = useState<ProctoringState>({
    status: "idle",
    errorMessage: null,
    faceCount: 0,
    isLookingAway: false,
    isReading: false,
    integrityScore: 100,
    flags: [],
    activeAlert: null,
    tabSwitchCount: 0,
    devtoolsCount: 0,
    pasteCount: 0,
    isMultiScreen: false,
    elapsedMs: 0,
  });
  const [faceBoxes, setFaceBoxes] = useState<FaceBox[]>([]);

  const pushFlag = useCallback((type: FlagType) => {
    setState((prev) => {
      const flag: ProctorFlag = {
        id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type,
        message: FLAG_LABEL[type],
        timestamp: Date.now(),
      };
      return {
        ...prev,
        integrityScore: Math.max(0, prev.integrityScore - FLAG_PENALTY[type]),
        flags: [flag, ...prev.flags].slice(0, 30),
        activeAlert: flag.message,
      };
    });
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      setState((prev) =>
        prev.activeAlert === FLAG_LABEL[type]
          ? { ...prev, activeAlert: null }
          : prev,
      );
    }, 2600);
  }, []);

  const detectLoop = useCallback(() => {
    // Detection has already failed MAX_CONSECUTIVE_DETECT_FAILURES times in a
    // row and the error state below has been set — stop scheduling further
    // frames instead of retrying forever against a context that isn't coming
    // back (e.g. a lost/never-created GL context).
    if (consecutiveDetectFailuresRef.current >= MAX_CONSECUTIVE_DETECT_FAILURES) {
      return;
    }

    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const now = performance.now();
    if (now - lastDetectAtRef.current < 1000 / DETECT_FPS) {
      rafRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    lastDetectAtRef.current = now;

    getLandmarker()
      .then((landmarker) => {
        if (!videoRef.current) return;
        const result = landmarker.detectForVideo(video, now);
        consecutiveDetectFailuresRef.current = 0;
        const faces = result.faceLandmarks ?? [];
        const wallClock = Date.now();

        setState((prev) => ({ ...prev, faceCount: faces.length }));

        // ---- multi-face ----
        if (faces.length > 1) {
          if (wallClock - lastMultiFaceFlagRef.current > MULTI_FACE_DEBOUNCE_MS) {
            lastMultiFaceFlagRef.current = wallClock;
            pushFlag("multi_face");
          }
        }

        // ---- no face ----
        if (faces.length === 0) {
          if (noFaceSinceRef.current === null) noFaceSinceRef.current = wallClock;
          const sustainedFor = wallClock - noFaceSinceRef.current;
          if (
            sustainedFor > NO_FACE_GRACE_MS &&
            wallClock - lastNoFaceFlagRef.current > RE_FLAG_INTERVAL_MS
          ) {
            lastNoFaceFlagRef.current = wallClock;
            pushFlag("no_face");
          }
        } else {
          noFaceSinceRef.current = null;
        }

        // ---- gaze / looking away (only meaningful with exactly one face) ----
        let lookingAway = false;
        const boxes: FaceBox[] = faces.map((landmarks) => {
          let minX = 1, minY = 1, maxX = 0, maxY = 0;
          for (const p of landmarks) {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
          }
          const away = faces.length === 1 && isLookingAwayFromLandmarks(landmarks);
          return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
            flagged: faces.length > 1 || away,
          };
        });
        setFaceBoxes(boxes);

        if (faces.length === 1) {
          lookingAway = isLookingAwayFromLandmarks(faces[0]);
          if (lookingAway) {
            if (lookingAwaySinceRef.current === null) {
              lookingAwaySinceRef.current = wallClock;
            }
            const sustainedFor = wallClock - lookingAwaySinceRef.current;
            if (
              sustainedFor > LOOKING_AWAY_GRACE_MS &&
              wallClock - lastLookAwayFlagRef.current > RE_FLAG_INTERVAL_MS
            ) {
              lastLookAwayFlagRef.current = wallClock;
              pushFlag("looking_away");
            }
          } else {
            lookingAwaySinceRef.current = null;
          }
        } else {
          lookingAwaySinceRef.current = null;
        }

        let isReading = false;
        if (faces.length === 1 && !lookingAway) {
          const irisRatio = getIrisHorizontalRatio(faces[0]);
          if (irisRatio !== null) {
            irisRatiosRef.current.push({ time: wallClock, ratio: irisRatio });
            irisRatiosRef.current = irisRatiosRef.current.filter((item) => wallClock - item.time < 3000);
            if (irisRatiosRef.current.length >= 6) {
              const ratios = irisRatiosRef.current.map((i) => i.ratio);
              const minRatio = Math.min(...ratios);
              const maxRatio = Math.max(...ratios);
              const diff = maxRatio - minRatio;
              let shifts = 0;
              for (let i = 1; i < ratios.length; i++) {
                if (Math.abs(ratios[i] - ratios[i - 1]) > 0.08) shifts++;
              }
              if (diff > 0.16 && shifts >= 2) {
                isReading = true;
                if (wallClock - lastReadingFlagRef.current > RE_FLAG_INTERVAL_MS) {
                  lastReadingFlagRef.current = wallClock;
                  pushFlag("reading_detected");
                }
              }
            }
          }
        }

        setState((prev) => ({
          ...prev,
          isLookingAway: lookingAway,
          isReading,
          elapsedMs: startedAtRef.current ? wallClock - startedAtRef.current : 0,
        }));
      })
      .catch((err) => {
        console.error("Face landmark detection failed", err);
        consecutiveDetectFailuresRef.current += 1;
        if (consecutiveDetectFailuresRef.current >= MAX_CONSECUTIVE_DETECT_FAILURES && mountedRef.current) {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage:
              "Camera analysis temporarily unavailable. Please check that your camera is enabled and try again.",
          }));
        }
      });

    rafRef.current = requestAnimationFrame(detectLoop);
  }, [pushFlag]);

  /** RMS-sampled ambient noise / cross-talk monitor */
  const sampleAudioLevel = useCallback(() => {
    const analyser = audioAnalyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const norm = (data[i] - 128) / 128;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const wallClock = Date.now();
    const isSpeakingPhase = interviewAudioPhaseRef.current === "speaking";

    if (isSpeakingPhase) {
      noiseSinceRef.current = null;
      if (rms > CROSS_TALK_RMS_THRESHOLD) {
        if (crossTalkSinceRef.current === null) crossTalkSinceRef.current = wallClock;
        const sustainedFor = wallClock - crossTalkSinceRef.current;
        if (
          sustainedFor > CROSS_TALK_SUSTAINED_MS &&
          wallClock - lastCrossTalkFlagRef.current > AUDIO_RE_FLAG_INTERVAL_MS
        ) {
          lastCrossTalkFlagRef.current = wallClock;
          pushFlag("cross_talk");
        }
      } else {
        crossTalkSinceRef.current = null;
      }
    } else {
      crossTalkSinceRef.current = null;
      if (rms > NOISE_RMS_THRESHOLD) {
        if (noiseSinceRef.current === null) noiseSinceRef.current = wallClock;
        const sustainedFor = wallClock - noiseSinceRef.current;
        if (
          sustainedFor > NOISE_SUSTAINED_MS &&
          wallClock - lastNoiseFlagRef.current > AUDIO_RE_FLAG_INTERVAL_MS
        ) {
          lastNoiseFlagRef.current = wallClock;
          pushFlag("background_noise");
        }
      } else {
        noiseSinceRef.current = null;
      }
    }
  }, [pushFlag]);

  const notifyInterviewPhase = useCallback((phase: InterviewAudioPhase) => {
    interviewAudioPhaseRef.current = phase;
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioLoopIntervalRef.current) {
      clearInterval(audioLoopIntervalRef.current);
      audioLoopIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    audioAnalyserRef.current = null;
    setFaceBoxes([]);
    setState((prev) => ({ ...prev, status: "idle", activeAlert: null }));
  }, []);

  const start = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      status: "starting",
      errorMessage: null,
      flags: [],
      integrityScore: 100,
      tabSwitchCount: 0,
      devtoolsCount: 0,
      pasteCount: 0,
    }));
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          "Camera access isn't available in this browser context (it requires HTTPS or localhost).",
      }));
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
    } catch (err) {
      console.error("Failed to acquire camera", err);
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access to run live proctoring."
            : "Could not start the camera. Make sure no other app is using it.",
      }));
      return;
    }

    if (!hasWebGLSupport()) {
      stream.getTracks().forEach((t) => t.stop());
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          "Camera analysis temporarily unavailable. Please check that your camera is enabled and try again.",
      }));
      return;
    }

    consecutiveDetectFailuresRef.current = 0;
    try {
      await getLandmarker();
    } catch (err) {
      console.error("Failed to load the face detection model", err);
      stream.getTracks().forEach((t) => t.stop());
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage:
          "Could not load the face detection model. Check that /mediapipe assets are served and reload the page.",
      }));
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    startedAtRef.current = Date.now();
    noFaceSinceRef.current = null;
    lookingAwaySinceRef.current = null;
    setState((prev) => ({ ...prev, status: "live" }));
    rafRef.current = requestAnimationFrame(detectLoop);

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStreamRef.current = audioStream;
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor) {
        const ctx = new AudioCtxCtor();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(audioStream).connect(analyser);
        audioAnalyserRef.current = analyser;
        noiseSinceRef.current = null;
        crossTalkSinceRef.current = null;
        audioLoopIntervalRef.current = window.setInterval(sampleAudioLevel, AUDIO_SAMPLE_INTERVAL_MS);
      }
    } catch (err) {
      console.error("Failed to acquire mic for noise/cross-talk detection", err);
    }
  }, [detectLoop, sampleAudioLevel]);

  // Anti-Cheat: Tab switch, DevTools, Paste, & Multi-screen detection listeners
  useEffect(() => {
    if (state.status !== "live") return;

    // 1. Tab switch / focus loss
    const flagTabSwitch = () => {
      const now = Date.now();
      if (now - lastTabFlagRef.current < 800) return;
      lastTabFlagRef.current = now;
      setState((prev) => ({ ...prev, tabSwitchCount: prev.tabSwitchCount + 1 }));
      pushFlag("tab_switch");
    };

    const onVisibilityChange = () => {
      if (document.hidden) flagTabSwitch();
    };
    const onBlur = () => flagTabSwitch();

    // 2. DevTools shortcut interceptor (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U)
    const onKeyDown = (e: KeyboardEvent) => {
      const isF12 = e.key === "F12" || e.keyCode === 123;
      const isInspect = (e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key);
      const isViewSource = (e.ctrlKey || e.metaKey) && ["u", "U"].includes(e.key);

      if (isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - lastDevToolsFlagRef.current > 2000) {
          lastDevToolsFlagRef.current = now;
          setState((prev) => ({ ...prev, devtoolsCount: prev.devtoolsCount + 1 }));
          pushFlag("devtools_opened");
        }
      }
    };

    // 3. Context Menu block
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastDevToolsFlagRef.current > 2000) {
        lastDevToolsFlagRef.current = now;
        setState((prev) => ({ ...prev, devtoolsCount: prev.devtoolsCount + 1 }));
        pushFlag("devtools_opened");
      }
    };

    // 4. Paste interceptor
    const onPaste = (e: ClipboardEvent) => {
      const now = Date.now();
      if (now - lastPasteFlagRef.current > 2000) {
        lastPasteFlagRef.current = now;
        setState((prev) => ({ ...prev, pasteCount: prev.pasteCount + 1 }));
        pushFlag("paste_attempt");
      }
    };

    // 5. Multi-screen / Extended Display detection
    const checkMultiScreen = () => {
      try {
        const isExtended = (window.screen as any)?.isExtended === true;
        if (isExtended) {
          const now = Date.now();
          if (now - lastMultiScreenFlagRef.current > 10000) {
            lastMultiScreenFlagRef.current = now;
            setState((prev) => ({ ...prev, isMultiScreen: true }));
            pushFlag("multi_screen");
          }
        }
      } catch {}
    };

    checkMultiScreen();
    const multiScreenInterval = window.setInterval(checkMultiScreen, 5000);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("paste", onPaste);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("paste", onPaste);
      clearInterval(multiScreenInterval);
    };
  }, [state.status, pushFlag]);

  // Periodic Telemetry sync to Backend
  useEffect(() => {
    if (state.status !== "live" || !sessionId) return;
    const apiUrl = getApiBaseUrl();

    const syncTelemetry = async () => {
      try {
        await fetch(`${apiUrl}/api/v1/screening/proctor/telemetry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            timestamp: Date.now(),
            flags: state.flags.map((f) => ({
              id: f.id,
              type: f.type,
              message: f.message,
              timestamp: f.timestamp,
            })),
            face_count: state.faceCount,
            is_looking_away: state.isLookingAway,
            is_reading: state.isReading,
            tab_switch_count: state.tabSwitchCount,
            devtools_detected: state.devtoolsCount > 0,
            paste_detected: state.pasteCount > 0,
            multi_screen_detected: state.isMultiScreen,
            client_integrity_score: state.integrityScore,
          }),
        });
      } catch {}
    };

    const interval = window.setInterval(syncTelemetry, 6000);
    return () => clearInterval(interval);
  }, [state, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  return { videoRef, state, faceBoxes, start, stop, notifyInterviewPhase };
}
