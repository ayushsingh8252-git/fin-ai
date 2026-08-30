"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Mic, MicOff, Loader2, Sparkles, Volume2, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function VoiceCommandButton() {
  const router = useRouter();
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [supported, setSupported] = useState(true);
  const [statusMessage, setStatusMessage] = useState("");
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setSupported(false);
      }
    }
  }, []);

  const startListening = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Web Speech API is not supported in this browser. Please use Chrome/Edge or type your command directly.");
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => {
        setIsListening(true);
        setStatusMessage("Listening... Speak your command (e.g. 'Open Command Center' or 'Evaluate candidate resume')");
        setTranscript("");
      };

      recognition.onresult = (event: any) => {
        const current = event.resultIndex;
        const text = event.results[current][0].transcript;
        setTranscript(text);

        if (event.results[current].isFinal) {
          handleVoiceCommand(text);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("[VoiceCommand] Speech error:", event.error);
        setIsListening(false);
        setStatusMessage("Could not capture audio. Please check microphone permission.");
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("[VoiceCommand] Failed to start speech recognition:", err);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsListening(false);
  };

  const handleVoiceCommand = (spokenText: string) => {
    const lower = spokenText.toLowerCase();
    setStatusMessage(`Recognized: "${spokenText}" — Launching Command Center...`);

    setTimeout(() => {
      // Navigate to command center with prefilled prompt
      router.push(`/command-center?prompt=${encodeURIComponent(spokenText)}`);
    }, 600);
  };

  return (
    <div className="relative inline-flex flex-col items-start">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          className={`inline-flex items-center gap-2 px-5 py-3.5 rounded-xl text-[14px] font-semibold transition-all border ${
            isListening
              ? "bg-red-500/10 border-red-500 text-red-400 shadow-lg shadow-red-500/20 animate-pulse"
              : "border-zinc-800 text-zinc-300 bg-zinc-900/90 hover:bg-zinc-800 hover:border-zinc-700 hover:text-white"
          }`}
          title="Speak to open Command Center"
        >
          {isListening ? (
            <>
              <MicOff className="w-4 h-4 text-red-400" />
              <span>Listening... (Speak now)</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 text-emerald-400" />
              <span>Voice Activate Agent</span>
            </>
          )}
        </button>
      </div>

      {/* Voice status feedback popup */}
      <AnimatePresence>
        {(isListening || transcript) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="absolute left-0 top-full mt-2 w-80 p-3 rounded-xl bg-zinc-950/95 border border-zinc-800 shadow-2xl backdrop-blur-md z-30"
          >
            <div className="flex items-center gap-2 mb-1.5 text-xs text-zinc-400 font-mono">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>VOICE STREAM</span>
            </div>
            <div className="text-sm font-medium text-white">
              {transcript || statusMessage}
            </div>
            {transcript && (
              <div className="mt-2 text-[11px] text-zinc-400 font-mono flex items-center gap-1">
                <span>Dispatching command to agent</span>
                <ArrowRight className="w-3 h-3 text-emerald-400" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
