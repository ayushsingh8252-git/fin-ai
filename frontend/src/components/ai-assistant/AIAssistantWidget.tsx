"use client";

/* ═══════════════════════════════════════════════════════════════════════
   AI ASSISTANT WIDGET — enterprise-grade floating assistant (Phenom-style)

   Answers are produced by the platform's own RAG engine (POST /api/v1/query
   — the same endpoint the /rag workspace uses), so responses are grounded in
   whatever policies/documents have been indexed for this deployment.

   Everything under ASSISTANT_CONFIG is safe to edit without touching layout
   or behavior — name, subtitle, welcome copy, and the capability list shown
   in the empty-state are all sourced from here.
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { X, Send, Mic, Square, Volume2, VolumeX } from "lucide-react";
import ChatMarkdown from "../ChatMarkdown";
import AgentLatencyAnimation from "./AgentLatencyAnimation";

/** Fired by anything on the page (e.g. the hero's floating topic doodles) to open
 *  the assistant pre-loaded with a question — window-level so callers don't need
 *  a prop path down to wherever this widget happens to be mounted. */
export const ASK_ASSISTANT_EVENT = "agenticflow:ask-assistant";
export function askAssistant(query: string) {
  window.dispatchEvent(new CustomEvent<{ query: string }>(ASK_ASSISTANT_EVENT, { detail: { query } }));
}

export interface AIAssistantConfig {
  name: string;
  subtitle: string;
  greeting: string;
  intro: string;
  closingPrompt: string;
  speakCta: string;
}

export const ASSISTANT_CONFIG: AIAssistantConfig = {
  name: "Fin AI",
  subtitle: "Enterprise AI Assistant",
  greeting: "Hi there",
  intro: "I'm your Fin AI assistant — ask me about HR policy or the platform itself.",
  closingPrompt: "How can I help you today?",
  speakCta: "Speak with AI",
};

/** The assistant's identity mark — a slowly evolving sphere in the site's own
 *  blue palette (not a static bot glyph, and not an off-brand rainbow orb), with
 *  a small satellite orbiting it — the same "agents orbiting a core" language
 *  as the Agent Orchestrator section, in miniature, so this reads as part of
 *  the same system rather than a bolted-on widget. Fills whatever sized,
 *  `relative`-positioned circle wraps it. */
function CosmosBall({ orbit = true }: { orbit?: boolean }) {
  return (
    <>
      <span className="absolute inset-0 rounded-full overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800">
        <span className="absolute -inset-[45%] cosmos-swirl opacity-80" />
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 32% 26%, rgba(255,255,255,0.75), transparent 45%)", mixBlendMode: "screen" }}
        />
        <span className="absolute w-1 h-1 rounded-full bg-white cosmos-twinkle" style={{ top: "22%", left: "64%" }} />
        <span className="absolute w-[3px] h-[3px] rounded-full bg-white/90 cosmos-twinkle" style={{ top: "60%", left: "26%", animationDelay: "1s" }} />
        <span className="absolute w-1 h-1 rounded-full bg-white/80 cosmos-twinkle" style={{ top: "40%", left: "80%", animationDelay: "1.8s" }} />
      </span>
      {orbit && (
        <span className="absolute -inset-[3px] rounded-full cosmos-orbit pointer-events-none">
          <span className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-blue-300 shadow-[0_0_6px_2px_rgba(96,165,250,0.9)]" />
        </span>
      )}
    </>
  );
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  retrievalMode?: string;
  sourceCount?: number;
  isError?: boolean;
}

/* Minimal Web Speech API surface — not part of the standard TS DOM lib. */
interface SpeechRecognitionResultLike { transcript: string }
interface SpeechRecognitionResultEvent { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> }
interface SpeechRecognitionErrorEvent { error: string }
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function AIAssistantWidget({ config = ASSISTANT_CONFIG }: { config?: AIAssistantConfig }) {
  // /rag is already a dedicated full-screen chat workspace — skip the floating
  // launcher there so it doesn't overlap that page's own chat input/footer.
  const pathname = usePathname();
  const isChatWorkspaceRoute = pathname?.startsWith("/rag");

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastQueryFailed, setLastQueryFailed] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechOn, setSpeechOn] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop?.();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // Lets page-level UI (e.g. the hero's clickable doodles) open this widget with a
  // question already in flight, without prop-drilling through layout.tsx.
  const submitQueryRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    const handler = (e: Event) => {
      const query = (e as CustomEvent<{ query: string }>).detail?.query;
      if (!query) return;
      setIsOpen(true);
      submitQueryRef.current(query);
    };
    window.addEventListener(ASK_ASSISTANT_EVENT, handler);
    return () => window.removeEventListener(ASK_ASSISTANT_EVENT, handler);
  }, []);

  const speak = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[*#`_~]/g, ""));
    utterance.rate = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  const submitQuery = async (text: string) => {
    const query = text.trim();
    if (!query || isLoading) return;

    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: "user", content: query }]);
    setInput("");
    setIsLoading(true);
    setLastQueryFailed(false);

    try {
      const res = await fetch(`${API_URL}/api/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, top_k: 5 }),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = await res.json();

      const reply: ChatMessage = {
        id: `a${Date.now()}`,
        role: "assistant",
        content: data.answer || "I couldn't find anything relevant in the indexed documents for that yet.",
        retrievalMode: data.retrieval_mode,
        sourceCount: Array.isArray(data.sources) ? data.sources.length : 0,
      };
      setMessages((prev) => [...prev, reply]);
      if (speechOn) speak(reply.content);
    } catch {
      setLastQueryFailed(true);
      setMessages((prev) => [
        ...prev,
        {
          id: `a${Date.now()}`,
          role: "assistant",
          isError: true,
          content:
            "I'm having trouble reaching the knowledge engine right now. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    submitQueryRef.current = submitQuery;
  });

  // Server-side fallback transcription for browsers without SpeechRecognition (e.g. Firefox),
  // reusing the same /api/v1/transcribe endpoint the /rag workspace relies on.
  const startServerRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    audioChunksRef.current = [];

    recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const fd = new FormData();
      fd.append("file", blob, "recording.webm");
      try {
        const res = await fetch(`${API_URL}/api/v1/transcribe`, { method: "POST", body: fd });
        const data = await res.json();
        if (data.transcript) submitQuery(data.transcript);
        else setVoiceError("Didn't catch that — please try again.");
      } catch {
        setVoiceError("Could not reach the transcription server.");
      }
    };
    recorder.start();
    setIsRecording(true);
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
  };

  const startVoice = async () => {
    setVoiceError(null);
    if (typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)) {
      const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
      const SpeechRecognitionImpl = (w.SpeechRecognition || w.webkitSpeechRecognition) as SpeechRecognitionCtor;
      const recognition = new SpeechRecognitionImpl();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognitionRef.current = recognition;

      recognition.onresult = (event: SpeechRecognitionResultEvent) => {
        const transcript = Array.from(event.results as ArrayLike<ArrayLike<SpeechRecognitionResultLike>>)
          .map((r) => r[0].transcript)
          .join("");
        if (transcript.trim()) submitQuery(transcript);
      };
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        recognitionRef.current = null;
        setIsRecording(false);
        if (event.error === "no-speech" || event.error === "aborted") return;
        if (event.error === "network") { startServerRecording().catch(() => setVoiceError("Microphone access failed.")); return; }
        setVoiceError(event.error === "not-allowed" ? "Microphone access denied." : "Voice input error — please try again.");
      };
      recognition.onend = () => { if (recognitionRef.current === recognition) { setIsRecording(false); recognitionRef.current = null; } };

      recognition.start();
      setIsRecording(true);
      return;
    }

    try {
      await startServerRecording();
    } catch {
      setVoiceError("Could not access microphone. Check browser permissions.");
    }
  };

  const toggleMic = () => (isRecording ? stopRecording() : startVoice());
  const hasMessages = messages.length > 0;

  if (isChatWorkspaceRoute) return null;

  return (
    <>
      {/* ── Floating Launcher Button ── */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            key="launcher"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => setIsOpen(true)}
            aria-label={`Open ${config.name} assistant`}
            className="fixed bottom-5 right-5 sm:bottom-7 sm:right-7 z-[60] w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-xl shadow-indigo-900/40 flex items-center justify-center"
          >
            {/* Soft breathing glow — replaces the old hard-edged ping ring */}
            <span className="absolute -inset-2 rounded-full bg-gradient-to-br from-blue-500/35 via-indigo-500/25 to-transparent blur-md cosmos-glow" />
            <CosmosBall />
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-white z-10" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat Modal ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="modal"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            className="fixed z-[60] bottom-0 right-0 sm:bottom-6 sm:right-6 w-full h-[100dvh] sm:h-[min(700px,calc(100dvh-3rem))] sm:w-[min(440px,calc(100vw-2rem))] sm:rounded-3xl rounded-none bg-white/95 backdrop-blur-xl border border-zinc-200/80 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="shrink-0 px-4 sm:px-5 py-3.5 flex items-center justify-between bg-white border-b border-zinc-200">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative w-9 h-9 rounded-full shrink-0 shadow-sm">
                  <CosmosBall orbit={false} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold leading-tight text-zinc-900 truncate">{config.name}</div>
                  <div className="text-[11px] text-zinc-500 leading-tight truncate">{config.subtitle}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setSpeechOn((v) => !v)}
                  title={speechOn ? "Voice replies: on" : "Voice replies: off"}
                  className="p-2 rounded-lg text-zinc-400 hover:text-blue-600 hover:bg-zinc-100 transition-colors"
                >
                  {speechOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  aria-label="Close assistant"
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin bg-white">
              {!hasMessages ? (
                <div className="px-5 sm:px-6 pt-8 pb-6 flex flex-col items-center text-center">
                  {/* Hero avatar */}
                  <div className="relative w-16 h-16 rounded-full mb-4 shadow-md">
                    <CosmosBall />
                  </div>

                  <button
                    onClick={toggleMic}
                    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-white shadow-md transition-all hover:scale-[1.03] active:scale-[0.98] ${
                      isRecording ? "bg-red-500 shadow-red-500/30" : "bg-blue-600 shadow-blue-600/25 hover:bg-blue-700"
                    }`}
                  >
                    {isRecording ? <Square className="w-4 h-4 fill-white" /> : <Mic className="w-4 h-4" />}
                    {isRecording ? "Listening…" : config.speakCta}
                  </button>
                  {voiceError && <p className="text-[11px] text-red-500 font-medium mt-2">{voiceError}</p>}

                  <div className="mt-7 text-left w-full">
                    <p className="text-base font-bold text-zinc-900">{config.greeting}</p>
                    <p className="text-sm text-zinc-600 mt-0.5">{config.intro}</p>
                    <p className="text-sm text-zinc-700 font-medium mt-4">{config.closingPrompt}</p>
                  </div>
                </div>
              ) : (
                <div className="px-4 sm:px-5 py-4 space-y-3">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13px] leading-relaxed ${
                          m.role === "user"
                            ? "bg-blue-600 text-white rounded-br-md"
                            : m.isError
                            ? "bg-red-50 border border-red-200 text-red-700 rounded-bl-md"
                            : "bg-zinc-50 border border-zinc-200 text-zinc-800 rounded-bl-md"
                        }`}
                      >
                        {m.role === "assistant" && !m.isError ? (
                          <ChatMarkdown content={m.content} />
                        ) : (
                          <p className="whitespace-pre-wrap">{m.content}</p>
                        )}
                        {m.role === "assistant" && !m.isError && (
                          <div className="flex items-center gap-2 mt-1.5">
                            {typeof m.sourceCount === "number" && m.sourceCount > 0 && (
                              <span className="text-[10px] font-mono text-zinc-400">{m.sourceCount} source{m.sourceCount === 1 ? "" : "s"}</span>
                            )}
                            <button onClick={() => speak(m.content)} className="inline-flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-blue-600 transition-colors">
                              <Volume2 className="w-3 h-3" /> Listen
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <AgentLatencyAnimation
                    isLoading={isLoading}
                    didError={lastQueryFailed}
                    isTyping={!isLoading && input.trim().length > 0 && !isRecording}
                  />
                  {voiceError && <p className="text-[11px] text-red-500 font-medium text-center">{voiceError}</p>}
                </div>
              )}
            </div>

            {/* Footer / Input */}
            <div className="shrink-0 p-3 border-t border-zinc-200/80 bg-white">
              <div className="flex items-center gap-2 bg-zinc-100/80 border border-zinc-200 rounded-2xl px-2 py-1.5 focus-within:border-blue-400 focus-within:bg-white transition-colors">
                <button
                  onClick={toggleMic}
                  title={isRecording ? "Stop recording" : "Voice query"}
                  className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    isRecording ? "bg-red-500 text-white" : "text-zinc-500 hover:bg-zinc-200"
                  }`}
                >
                  {isRecording ? <Square className="w-3.5 h-3.5 fill-white" /> : <Mic className="w-4 h-4" />}
                </button>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitQuery(input); }}
                  placeholder="Ask about HR policy or the Fin AI platform…"
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none py-1.5"
                />
                <button
                  onClick={() => submitQuery(input)}
                  disabled={!input.trim() || isLoading}
                  className="shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-center text-[10px] text-zinc-400 font-mono mt-2">Powered by Fin AI RAG Engine</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
