"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import {
  Send, Upload, Loader2, Crosshair, ArrowLeft, Sparkles,
  FileText, X, CheckCircle2, Search, Globe,
  Users, MessageSquare,
  Share2, FileCode, Layers,
  Command, Terminal, Bot, ArrowRight, CornerDownLeft,
  Mic, Volume2, VolumeX, Radio, FileAudio, Square,
  AlertCircle, Link2, Mail, Plug, Plus, Trash2, Edit2, Check,
  PanelLeftClose, PanelLeft, Menu, Clock
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import ChatMarkdown from "@/components/ChatMarkdown";
import AgentLatencyAnimation from "@/components/ai-assistant/AgentLatencyAnimation";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-zinc-400 text-xs font-mono animate-pulse bg-zinc-900">
      Loading PDF Source Engine...
    </div>
  ),
});

type Source = {
  document_id?: string;
  page?: number;
  bbox?: number[];
  page_dim?: number[];
  is_audio?: boolean;
  timestamp_str?: string;
  start_time?: number;
  end_time?: number;
  title?: string;
  url?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  detected_language?: string;
  language_name?: string;
  original_query?: string;
  translated_query?: string;
  isAgentic?: boolean;
  isError?: boolean;
  latencyMs?: number;
  retrieval_mode?: "rules" | "chunks" | "missing";
};

type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

type Rule = {
  id: string;
  canonical_rule: string;
  type: string;
  confidence: number;
  bbox?: number[];
  page_dim?: number[];
  page?: number;
  document_id?: string;
};

type DocumentItem = {
  id: string;
  fileName: string;
  uploadedAt: string;
  extractedRules: Rule[];
  status: "idle" | "uploaded" | "processing" | "completed" | "failed";
  chunkCount?: number;
};

const DEFAULT_WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "Agent online. Synchronized with the shared document index and active MCP tools. Upload a document, crawl a link, or type `/` to open the Command Palette.",
};

const STORAGE_KEY_SESSIONS = "agenticflow_rag_sessions_v1";
const STORAGE_KEY_ACTIVE = "agenticflow_rag_active_session_v1";

// Production MCP Agent Tools Registry matching the Light UI Theme
const CONNECTORS = [
  {
    id: "connectors",
    command: "/connectors",
    name: "MCP Server Registry",
    agenticLabel: "Core MCP Registry",
    category: "System Tool",
    desc: "Inspect connected Model Context Protocol servers, vector stores & tool schemas",
    icon: Plug,
    color: "text-blue-600 bg-blue-50 border-blue-200",
    status: "9 Tools Ready",
    agentAction: "GET /mcp/registry/tools",
  },
  {
    id: "github-mcp",
    command: "/github",
    name: "GitHub MCP Agent",
    agenticLabel: "Codebase MCP",
    category: "Developer Tools",
    desc: "Index pull requests, commit diffs, AST symbols & repository codebases",
    icon: GithubIcon,
    color: "text-purple-600 bg-purple-50 border-purple-200",
    status: "Connected",
    agentAction: "github.search_repository_ast",
  },
  {
    id: "slack",
    command: "/slack",
    name: "Slack Channel Agent",
    agenticLabel: "Communications MCP",
    category: "Messaging",
    desc: "Retrieve decision logs, channel threads & workspace Huddle transcripts",
    icon: MessageSquare,
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    status: "Connected",
    agentAction: "slack.query_channels_vector",
  },
  {
    id: "confluence",
    command: "/confluence",
    name: "Confluence Wiki MCP",
    agenticLabel: "Documentation MCP",
    category: "Knowledge Base",
    desc: "Semantic search across team RFCs, architecture specs & wiki pages",
    icon: FileCode,
    color: "text-sky-600 bg-sky-50 border-sky-200",
    status: "Connected",
    agentAction: "confluence.search_spaces",
  },
  {
    id: "jira",
    command: "/jira",
    name: "Jira Sprint Agent",
    agenticLabel: "Issue Graph MCP",
    category: "Project Mgmt",
    desc: "Fetch sprint backlogs, bug tickets, epics & velocity metadata",
    icon: Layers,
    color: "text-cyan-600 bg-cyan-50 border-cyan-200",
    status: "Ready",
    agentAction: "jira.get_ticket_graph",
  },
  {
    id: "gdrive",
    command: "/gdrive",
    name: "Google Drive MCP",
    agenticLabel: "Storage MCP",
    category: "Cloud Storage",
    desc: "Index Google Docs, Sheets, Presentations & shared team drives",
    icon: Share2,
    color: "text-amber-600 bg-amber-50 border-amber-200",
    status: "Connected",
    agentAction: "gdrive.scan_corpus",
  },
  {
    id: "notion",
    command: "/notion",
    name: "Notion Workspace Tool",
    agenticLabel: "Database MCP",
    category: "Workspace",
    desc: "Query engineering roadmaps, meeting notes & database tables",
    icon: FileText,
    color: "text-zinc-800 bg-zinc-100 border-zinc-300",
    status: "Ready",
    agentAction: "notion.query_databases",
  },
  {
    id: "gmail",
    command: "/gmail",
    name: "Gmail Thread Agent",
    agenticLabel: "Email MCP",
    category: "Communications",
    desc: "Parse official announcements, client threads & HR notices",
    icon: Mail,
    color: "text-red-600 bg-red-50 border-red-200",
    status: "Ready",
    agentAction: "gmail.search_thread_store",
  },
  {
    id: "outlook",
    command: "/outlook",
    name: "Outlook Calendar Tool",
    agenticLabel: "Enterprise Mail Tool",
    category: "Email & Calendar",
    desc: "Retrieve meeting notes, calendar invites & executive updates",
    icon: Mail,
    color: "text-blue-600 bg-blue-50 border-blue-200",
    status: "Ready",
    agentAction: "outlook.graph_query",
  },
  {
    id: "teams",
    command: "/teams",
    name: "MS Teams Agent",
    agenticLabel: "Transcript MCP",
    category: "Messaging",
    desc: "Extract meeting transcripts, group chats & voice notes",
    icon: Users,
    color: "text-indigo-600 bg-indigo-50 border-indigo-200",
    status: "Ready",
    agentAction: "teams.parse_transcripts",
  },
];

function formatSessionDate(timestamp: number): string {
  const now = Date.now();
  const diffMinutes = Math.floor((now - timestamp) / (1000 * 60));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function RAGPage() {
  // ── 1. Active View Tab ──
  const [activeTab, setActiveTab] = useState<"chat" | "rules" | "connectors">("chat");

  // ── 2. Sidebar & Session History State ──
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sessionSearch, setSessionSearch] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const initialSessionId = "session-" + Date.now();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>(initialSessionId);

  // ── 3. Documents & Active Document State ──
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string | null>(null);
  const [extractedRules, setExtractedRules] = useState<Rule[]>([]);
  const [docStatus, setDocStatus] = useState<"idle" | "uploaded" | "processing" | "completed" | "failed">("idle");
  const [docError, setDocError] = useState<string | null>(null);
  const [isRetryingDoc, setIsRetryingDoc] = useState(false);
  // "uploaded" and "processing" both mean "not queryable yet" — the backend
  // reports "uploaded" the instant the file is saved (before the background
  // ingestion thread has even started) and "processing" once it's actually
  // parsing/chunking/embedding. Either way the corpus for this document isn't
  // searchable yet, so both states gate the chat input identically.
  const isDocIndexing = docStatus === "uploaded" || docStatus === "processing";
  const [activeSource, setActiveSource] = useState<Source | null>(null);
  const [activeSourceMsgId, setActiveSourceMsgId] = useState<string | null>(null);

  // ── 4. Chat State ──
  const [messages, setMessages] = useState<Message[]>([DEFAULT_WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [lastQueryFailed, setLastQueryFailed] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // ── Add Link (Web Crawl) State ──
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState("");
  const [isCrawlingLink, setIsCrawlingLink] = useState(false);

  // ── 5. Command Palette Menu State ──
  const [showSlashMenu, setShowSlashMenu] = useState(false);

  // ── 6. Voice Mode & Audio State ──
  const [isVoiceMode, setIsVoiceMode] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [activeSpeechMsgId, setActiveSpeechMsgId] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState<number>(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const latestTranscriptRef = useRef<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rulesEndRef = useRef<HTMLDivElement>(null);
  const prevRulesCountRef = useRef(0);
  const announcedChunkCountRef = useRef<Set<string>>(new Set());

  // ── Load Sessions from localStorage on mount ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_SESSIONS);
      const activeId = localStorage.getItem(STORAGE_KEY_ACTIVE);
      if (stored) {
        const parsed: ChatSession[] = JSON.parse(stored);
        if (parsed.length > 0) {
          setSessions(parsed);
          const targetId = activeId && parsed.some(s => s.id === activeId) ? activeId : parsed[0].id;
          setCurrentSessionId(targetId);
          const activeSession = parsed.find(s => s.id === targetId);
          if (activeSession) {
            setMessages(activeSession.messages.length > 0 ? activeSession.messages : [DEFAULT_WELCOME_MESSAGE]);
          }
          return;
        }
      }
      // Initial default session
      const newSession: ChatSession = {
        id: initialSessionId,
        title: "New Conversation",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [DEFAULT_WELCOME_MESSAGE],
      };
      setSessions([newSession]);
      setCurrentSessionId(initialSessionId);
      setMessages([DEFAULT_WELCOME_MESSAGE]);
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify([newSession]));
      localStorage.setItem(STORAGE_KEY_ACTIVE, initialSessionId);
    } catch {
      // Fallback
    }
  }, []);

  // ── Sync messages to active session in state & localStorage ──
  useEffect(() => {
    if (!currentSessionId) return;
    setSessions(prev => {
      const existing = prev.find(s => s.id === currentSessionId);
      if (!existing) {
        const fresh: ChatSession = {
          id: currentSessionId,
          title: "New Conversation",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages,
        };
        const next = [fresh, ...prev];
        try {
          localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(next));
          localStorage.setItem(STORAGE_KEY_ACTIVE, currentSessionId);
        } catch {}
        return next;
      }

      // Auto-name title from first user query if still default
      let title = existing.title;
      if (title === "New Conversation") {
        const firstUserMsg = messages.find(m => m.role === "user");
        if (firstUserMsg) {
          title = firstUserMsg.content.slice(0, 34) + (firstUserMsg.content.length > 34 ? "..." : "");
        }
      }

      const updated = prev.map(s =>
        s.id === currentSessionId
          ? { ...s, messages, updatedAt: Date.now(), title }
          : s
      );
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updated));
        localStorage.setItem(STORAGE_KEY_ACTIVE, currentSessionId);
      } catch {}
      return updated;
    });
  }, [messages, currentSessionId]);

  // ── Session Operations ──
  const handleCreateNewSession = () => {
    const newId = "session-" + Date.now();
    const newSession: ChatSession = {
      id: newId,
      title: "New Conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [DEFAULT_WELCOME_MESSAGE],
    };
    setSessions(prev => {
      const updated = [newSession, ...prev];
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updated));
        localStorage.setItem(STORAGE_KEY_ACTIVE, newId);
      } catch {}
      return updated;
    });
    setCurrentSessionId(newId);
    setMessages([DEFAULT_WELCOME_MESSAGE]);
    setActiveSource(null);
    setActiveTab("chat");
    // On small screens, close sidebar drawer
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleSelectSession = (sessionId: string) => {
    if (sessionId === currentSessionId) return;
    const target = sessions.find(s => s.id === sessionId);
    if (!target) return;
    setCurrentSessionId(sessionId);
    setMessages(target.messages.length > 0 ? target.messages : [DEFAULT_WELCOME_MESSAGE]);
    setActiveSource(null);
    setActiveTab("chat");
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE, sessionId);
    } catch {}
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = sessions.filter(s => s.id !== sessionId);
    if (remaining.length === 0) {
      handleCreateNewSession();
      return;
    }
    setSessions(remaining);
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(remaining));
    } catch {}
    if (currentSessionId === sessionId) {
      const nextActive = remaining[0];
      setCurrentSessionId(nextActive.id);
      setMessages(nextActive.messages.length > 0 ? nextActive.messages : [DEFAULT_WELCOME_MESSAGE]);
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE, nextActive.id);
      } catch {}
    }
  };

  const handleStartRename = (session: ChatSession, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleSaveRename = (sessionId: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editingTitle.trim() || "Untitled Conversation";
    setSessions(prev => {
      const updated = prev.map(s => s.id === sessionId ? { ...s, title: trimmed } : s);
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    setEditingSessionId(null);
    setEditingTitle("");
  };

  // Filtered Sessions
  const filteredSessions = sessions.filter(s =>
    s.title.toLowerCase().includes(sessionSearch.toLowerCase()) ||
    s.messages.some(m => m.content.toLowerCase().includes(sessionSearch.toLowerCase()))
  );

  // Fallback path: faster-whisper recording
  const startServerRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", audioBlob, "recording.webm");

      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const res = await fetch(`${apiUrl}/api/v1/transcribe`, {
          method: "POST",
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.transcript) {
            if (isVoiceMode) {
              submitQuery(data.transcript);
            } else {
              setInput(data.transcript);
            }
          } else {
            setVoiceError("Didn't catch that — please try again.");
          }
        } else {
          setVoiceError("Transcription failed. Please try again.");
        }
      } catch (err) {
        console.error("Transcription error:", err);
        setVoiceError("Could not reach the transcription server.");
      }
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.start();
    setIsRecording(true);

    recordingTimerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  };

  // Start Mic Recording
  const startRecording = async () => {
    try {
      setVoiceError(null);
      setRecordingTime(0);
      audioChunksRef.current = [];
      latestTranscriptRef.current = "";

      if (typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-US";
        recognitionRef.current = recognition;

        recognition.onresult = (event: any) => {
          const transcript = Array.from(event.results)
            .map((res: any) => res[0].transcript)
            .join("");
          latestTranscriptRef.current = transcript;
          setInput(transcript);
        };

        recognition.onerror = (event: any) => {
          if (event.error === "no-speech" || event.error === "aborted") return;
          if (recognitionRef.current === recognition) recognitionRef.current = null;
          if (event.error === "network") {
            if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
            startServerRecording().catch((fallbackErr) => {
              console.error("Fallback recording failed:", fallbackErr);
              setVoiceError("Could not access microphone. Check browser permissions.");
              setIsRecording(false);
            });
            return;
          }
          const messages: Record<string, string> = {
            "not-allowed": "Microphone access denied. Allow mic permissions and try again.",
            "audio-capture": "No microphone found on this device.",
          };
          setVoiceError(messages[event.error] || "Voice recognition error. Please try again.");
          setIsRecording(false);
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        };

        recognition.onend = () => {
          if (recognitionRef.current !== recognition) return;
          setIsRecording(false);
          recognitionRef.current = null;
          if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);

          const finalTranscript = latestTranscriptRef.current.trim();
          if (isVoiceMode && finalTranscript) {
            latestTranscriptRef.current = "";
            submitQuery(finalTranscript);
          }
        };

        recognition.start();
        setIsRecording(true);

        recordingTimerRef.current = setInterval(() => {
          setRecordingTime((prev) => prev + 1);
        }, 1000);
        return;
      }

      await startServerRecording();
    } catch (err) {
      console.error("Could not access microphone:", err);
      setVoiceError("Could not access microphone. Check browser permissions.");
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);

    const wasUsingSpeechRecognition = !!recognitionRef.current;
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (wasUsingSpeechRecognition && isVoiceMode) {
      const finalTranscript = latestTranscriptRef.current.trim();
      latestTranscriptRef.current = "";
      if (finalTranscript) submitQuery(finalTranscript);
    }
  };

  const toggleVoiceMode = () => {
    if (isVoiceMode) {
      if (isRecording) stopRecording();
      if (isSpeaking && typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        setActiveSpeechMsgId(null);
      }
      setVoiceError(null);
    }
    setIsVoiceMode((prev) => !prev);
  };

  const speakText = (text: string, msgId?: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setActiveSpeechMsgId(null);
      if (msgId === activeSpeechMsgId) return;
    }

    const cleanText = text.replace(/[*#`_~]/g, "").trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsSpeaking(true);
      if (msgId) setActiveSpeechMsgId(msgId);
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setActiveSpeechMsgId(null);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setActiveSpeechMsgId(null);
    };

    window.speechSynthesis.speak(utterance);
  };

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (activeSource && activeSourceMsgId) {
      messageRefs.current[activeSourceMsgId]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSource, activeSourceMsgId]);

  useEffect(() => {
    if (activeTab === "rules" && extractedRules.length > prevRulesCountRef.current) {
      rulesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    prevRulesCountRef.current = extractedRules.length;
  }, [extractedRules, activeTab]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Handle Slash Menu visibility
  useEffect(() => {
    if (input.startsWith("/")) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  }, [input]);

  const filteredCommands = CONNECTORS.filter((c) =>
    c.command.toLowerCase().includes(input.toLowerCase()) ||
    c.name.toLowerCase().includes(input.replace("/", "").toLowerCase())
  );

  // Fetch Rules from Backend API
  const fetchRules = async (docIdOverride?: string | null) => {
    const targetDocId = docIdOverride !== undefined ? docIdOverride : currentDocId;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = targetDocId
        ? `${apiUrl}/api/v1/rules?document_id=${targetDocId}`
        : `${apiUrl}/api/v1/rules`;
      const res = await fetch(url).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        const rules = data.rules || [];
        const status = data.status || "completed";
        const chunkCount: number | undefined = typeof data.chunk_count === "number" ? data.chunk_count : undefined;

        setExtractedRules(rules);
        setDocStatus(status);
        setDocError(typeof data.error === "string" ? data.error : null);
        if (targetDocId) {
          setDocuments((prev) =>
            prev.map((doc) =>
              doc.id === targetDocId
                ? { ...doc, extractedRules: rules, status: status, chunkCount: chunkCount ?? doc.chunkCount }
                : doc
            )
          );

          if (status === "completed" && chunkCount !== undefined && !announcedChunkCountRef.current.has(targetDocId)) {
            announcedChunkCountRef.current.add(targetDocId);
            setMessages((prev) => [
              ...prev,
              {
                id: `chunk-count-${targetDocId}`,
                role: "assistant",
                content: `Finished indexing — **${chunkCount}** vector chunk${chunkCount === 1 ? "" : "s"} now searchable. Ask a question about it, or check the Extracted Rules tab.`,
              },
            ]);
          }
        }
      } else {
        setExtractedRules([]);
      }
    } catch {
      setExtractedRules([]);
    }
  };

  useEffect(() => {
    fetchRules();
    const interval = setInterval(() => {
      if (docStatus === "processing" || docStatus === "uploaded") {
        fetchRules();
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [currentDocId, docStatus]);

  // Retries ingestion for a document that failed, via the idempotent
  // reprocess endpoint (deletes any partial chunks/rules/vectors first, so
  // this never double-indexes). Resumes the existing poll loop above once
  // the backend confirms it re-queued the job.
  const retryDocument = async (docId: string) => {
    setIsRetryingDoc(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/documents/${docId}/reprocess`, { method: "POST" });
      if (res.ok) {
        setDocStatus("uploaded");
        setDocError(null);
        setDocuments((prev) => prev.map((d) => (d.id === docId ? { ...d, status: "uploaded" } : d)));
        if (docId === currentDocId) {
          fetchRules(docId);
        }
      } else {
        const data = await res.json().catch(() => null);
        setDocError(data?.detail || "Retry failed. Please try re-uploading the file.");
      }
    } catch {
      setDocError("Retry failed — could not reach the backend.");
    } finally {
      setIsRetryingDoc(false);
    }
  };

  // Handle File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setExtractedRules([]);
    setCurrentDocId(null);
    setCurrentFileName(file.name);
    setDocStatus("uploaded");
    setDocError(null);
    setActiveSource(null);

    const tempDocId = "doc-" + Date.now();
    const newDoc: DocumentItem = {
      id: tempDocId,
      fileName: file.name,
      uploadedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      extractedRules: [],
      status: "uploaded",
    };

    setDocuments((prev) => [...prev, newDoc]);
    setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", content: `Upload: ${file.name}` }]);

    const formData = new FormData();
    formData.append("files", file);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/upload`, {
        method: "POST",
        body: formData,
      }).catch(() => null);

      // The /upload response only means "file saved, queued" — real ingestion
      // (parse -> chunk -> embed -> index) runs async in a background thread
      // on the backend. Status here is deliberately "uploaded", not
      // "completed": the poll loop above (fetchRules while status is
      // "uploaded"/"processing") is the only source of truth for when this
      // document is actually queryable. If the HTTP call itself failed, this
      // is a genuine failure — the backend never received the file — so it's
      // marked "failed" rather than silently claiming success.
      if (!res || !res.ok) {
        throw new Error(`Upload request failed${res ? ` (${res.status})` : ""}`);
      }
      const uploadData = await res.json();
      const result = uploadData.results?.[0];
      if (!result || result.status === "failed") {
        throw new Error(result?.reason || "Upload was rejected by the server.");
      }

      const docId = result.document_id;
      setCurrentDocId(docId);

      setDocuments((prev) =>
        prev.map((d) => (d.id === tempDocId ? { ...d, id: docId, status: "uploaded" } : d))
      );

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Received \`${file.name}\`. Indexing now — check the Extracted Rules tab for live progress. You'll be able to ask questions about it once indexing finishes.`,
        },
      ]);
    } catch (err) {
      setCurrentDocId(tempDocId);
      setDocStatus("failed");
      setDocError(err instanceof Error ? err.message : "Upload failed.");
      setDocuments((prev) => prev.map((d) => (d.id === tempDocId ? { ...d, status: "failed" } : d)));
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Could not index \`${file.name}\` — the upload failed. You can try uploading it again.`,
        },
      ]);
    } finally {
      setIsUploading(false);
    }
  };

  // Crawl a URL
  const handleUrlUpload = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let url = linkInputValue.trim();
    if (!url || isCrawlingLink) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

    setIsCrawlingLink(true);
    setExtractedRules([]);
    setCurrentDocId(null);
    setCurrentFileName(url);
    setDocStatus("processing");
    setActiveSource(null);

    const tempDocId = "doc-" + Date.now();
    const newDoc: DocumentItem = {
      id: tempDocId,
      fileName: url,
      uploadedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      extractedRules: [],
      status: "processing",
    };

    setDocuments((prev) => [...prev, newDoc]);
    setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", content: `Crawl link: ${url}` }]);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => null);

      if (!res || !res.ok) {
        throw new Error(`Crawl request failed${res ? ` (${res.status})` : ""}`);
      }
      const docId = (await res.json()).document_id || tempDocId;
      setCurrentDocId(docId);
      setDocStatus("processing");
      setDocError(null);

      setDocuments((prev) =>
        prev.map((d) => (d.id === tempDocId ? { ...d, id: docId, status: "processing" } : d))
      );

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Crawling \`${url}\`. Indexing now — check the Extracted Rules tab for live progress. You'll be able to ask questions about it once indexing finishes.`,
        },
      ]);
    } catch {
      setCurrentDocId(tempDocId);
      setDocStatus("failed");
      setDocError("The page may block automated access or the URL is unreachable.");
      setDocuments((prev) => prev.map((d) => (d.id === tempDocId ? { ...d, status: "failed" } : d)));
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Could not crawl \`${url}\`. The page may block automated access or the URL is unreachable.`,
        },
      ]);
    } finally {
      setIsCrawlingLink(false);
      setLinkInputValue("");
      setShowLinkInput(false);
    }
  };

  const applySlashCommand = (cmd: typeof CONNECTORS[0]) => {
    setShowSlashMenu(false);
    if (cmd.command === "/connectors") {
      setActiveTab("connectors");
      setInput("");
    } else {
      setInput(`${cmd.command} `);
      inputRef.current?.focus();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || isDocIndexing) return;
    const userQuery = input.trim();
    setInput("");
    await submitQuery(userQuery);
  };

  const handleGithubCommand = async (userQuery: string, queryText: string) => {
    setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", content: userQuery }]);

    const urlMatch = queryText.match(/github\.com\/([\w.-]+)(?:\/([\w.-]+))?/i);
    const shorthandMatch = !urlMatch ? queryText.match(/\b([\w.-]+)\/([\w.-]+)\b/) : null;
    const owner = urlMatch?.[1] || shorthandMatch?.[1];
    const repo = (urlMatch?.[2] || shorthandMatch?.[2])?.replace(/\.git$/, "");
    const wantsList = /\blist\b.*\brepos?\b|\brepos?\b.*\blist\b|all (my )?repos?/i.test(queryText);
    const wantsPRs = /\bprs?\b|pull ?requests?/i.test(queryText);

    let tool: string;
    let params: Record<string, unknown>;
    if (wantsList || (owner && !repo)) {
      tool = "list_repositories";
      params = owner ? { username: owner } : {};
    } else if (owner && repo && wantsPRs) {
      tool = "list_pull_requests";
      params = { owner, repo, state: "all" };
    } else if (owner && repo) {
      tool = "get_repository";
      params = { owner, repo };
    } else {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          isAgentic: true,
          isError: true,
          content:
            "Couldn't tell what to do with that. Try:\n" +
            "- `/github list my repos`\n" +
            "- `/github owner/repo`\n" +
            "- `/github owner/repo prs`\n" +
            "- `/github https://github.com/owner/repo`",
        },
      ]);
      return;
    }

    setIsLoading(true);
    setLastQueryFailed(false);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/mcp/connectors/github/tools/${tool}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();

      let content: string;
      if (!res.ok) {
        content = `GitHub MCP call failed (${res.status}): ${data.detail?.message || data.detail || "unknown error"}`;
      } else if (tool === "list_repositories") {
        content = data.repositories?.length
          ? `${owner ? `**${owner}**'s` : "Your"} repositories (${data.repositories.length}):\n\n${data.repositories
              .map((r: { full_name: string; private: boolean; open_issues: number }) => `- [${r.full_name}](https://github.com/${r.full_name})${r.private ? " 🔒" : ""} — ${r.open_issues} open issue(s)`)
              .join("\n")}`
          : "No repositories found.";
      } else if (tool === "list_pull_requests") {
        content = data.pull_requests?.length
          ? `**${owner}/${repo}** — ${data.pull_requests.length} pull request(s):\n\n${data.pull_requests
              .map((p: { number: number; state: string; title: string }) => `#${p.number} [${p.state}] ${p.title}`)
              .join("\n")}`
          : `**${owner}/${repo}** has no pull requests.`;
      } else {
        content = `**${data.full_name}**\nDefault branch: \`${data.default_branch}\`\nOpen issues: ${data.open_issues}\n${data.url}`;
      }

      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", isAgentic: true, isError: !res.ok, content }]);
    } catch {
      setLastQueryFailed(true);
      setMessages((prev) => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", isAgentic: true, isError: true, content: "Could not reach the GitHub MCP endpoint." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const submitQuery = async (rawQuery: string) => {
    if (!rawQuery.trim() || isLoading) return;

    const userQuery = rawQuery.trim();
    setShowSlashMenu(false);
    const startTime = performance.now();

    // Slash Command Handling
    if (userQuery.startsWith("/")) {
      const cmdObj = CONNECTORS.find(
        (c) => c.command.toLowerCase() === userQuery.toLowerCase().split(" ")[0]
      );

      if (cmdObj) {
        if (cmdObj.command === "/connectors") {
          setActiveTab("connectors");
          setMessages((prev) => [
            ...prev,
            { id: Date.now().toString(), role: "user", content: userQuery },
            {
              id: (Date.now() + 1).toString(),
              role: "assistant",
              isAgentic: true,
              content: `Connectors Registry: 9 Active MCP Tools\n\n${CONNECTORS.filter(c => c.id !== "connectors").map(c => `• ${c.command.padEnd(12)} | ${c.name.padEnd(22)} | ${c.status}`).join("\n")}`,
            },
          ]);
          return;
        }

        const queryText = userQuery.replace(cmdObj.command, "").trim();

        if (cmdObj.command === "/github") {
          await handleGithubCommand(userQuery, queryText);
          return;
        }

        setMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "user", content: userQuery },
          {
            id: (Date.now() + 1).toString(),
            role: "assistant",
            isAgentic: true,
            content: `Tool Executed: \`${cmdObj.name}\` (${cmdObj.status})\nAction: ${cmdObj.agentAction}\nSearch Query: "${queryText || "all items"}" across ${cmdObj.category} vector store.`,
          },
        ]);
        return;
      }
    }

    // Slash-command tool calls above are unaffected, but a real document
    // question asked while the just-uploaded document is still indexing
    // would hit an incomplete (or empty) corpus and come back with a
    // hollow "missing from context" answer — this is the race condition
    // fix: refuse the query and say so, instead of asking anyway.
    if (isDocIndexing) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "user", content: userQuery },
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `\`${currentFileName || "This document"}\` is still being indexed. You can ask questions once processing is complete.`,
        },
      ]);
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), role: "user", content: userQuery }]);
    setIsLoading(true);
    setLastQueryFailed(false);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiUrl}/api/v1/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: userQuery,
          top_k: 5,
        }),
      });

      if (!res.ok) throw new Error(`Query failed: ${res.status}`);
      const data = await res.json();
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      const newMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer,
        sources: data.sources,
        detected_language: data.detected_language,
        language_name: data.language_name,
        original_query: data.original_query,
        translated_query: data.translated_query,
        retrieval_mode: data.retrieval_mode,
        latencyMs: latency,
      };

      setMessages((prev) => [...prev, newMsg]);

      if (isVoiceMode && data.answer) {
        speakText(data.answer, newMsg.id);
      }
    } catch (err) {
      console.error("Query failed:", err);
      setLastQueryFailed(true);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        isError: true,
        content: "I'm having trouble reaching the knowledge engine right now. Please try again in a moment.",
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const activeSourceDoc = activeSource
    ? documents.find((d) => d.id === activeSource.document_id)
    : null;
  const activeSourceFileName = activeSourceDoc
    ? `${activeSourceDoc.id}_${activeSourceDoc.fileName}`
    : null;
  const activeSourceNotFound = !!activeSource && !activeSourceDoc;

  return (
    <div className="h-screen w-screen bg-white bg-white-grid flex flex-col overflow-hidden selection:bg-blue-500/20 font-sans text-zinc-900 relative">
      {/* ── TOP NAV BAR ── */}
      <header className="h-16 shrink-0 bg-white/90 backdrop-blur-md border-b border-zinc-200/80 px-4 sm:px-6 flex items-center justify-between z-30">
        <div className="flex items-center gap-2.5 sm:gap-4">
          <button
            type="button"
            onClick={() => setIsSidebarOpen((prev) => !prev)}
            className="p-2 rounded-xl text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 border border-zinc-200 transition-colors shadow-2xs"
            title={isSidebarOpen ? "Collapse Session History" : "Open Session History"}
          >
            {isSidebarOpen ? <PanelLeftClose className="w-4 h-4 text-blue-600" /> : <PanelLeft className="w-4 h-4 text-zinc-600" />}
          </button>

          <Link
            href="/"
            className="hidden sm:flex items-center gap-2 text-xs font-mono font-semibold text-zinc-600 hover:text-zinc-900 transition-colors bg-zinc-100/80 hover:bg-zinc-200/80 px-3 py-1.5 rounded-lg border border-zinc-200/80"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Link>

          <div className="hidden sm:block h-4 w-px bg-zinc-200" />

          <Link href="/" className="flex items-center gap-2 group">
            <BrandMark variant="dark" />
            <span className="font-bold text-[14px] sm:text-[15px] tracking-tight text-zinc-900 truncate">
              AgenticFlow <span className="text-blue-600 font-mono text-[10px] sm:text-xs uppercase ml-1 px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 hidden md:inline">RAG Workspace</span>
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleCreateNewSession}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Chat</span>
          </button>

          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-lg bg-zinc-50 border border-zinc-200 text-xs font-mono text-zinc-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>HNSW Index Active ({documents.length} Docs)</span>
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
          MAIN WORKSPACE LAYOUT (SIDEBAR + CONTENT + PDF INSPECTOR)
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative z-10">
        {/* Mobile Backdrop for Sidebar Drawer */}
        <AnimatePresence>
          {isSidebarOpen && (
            <motion.div
              key="sidebar-mobile-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden absolute inset-0 z-40 bg-zinc-900/40 backdrop-blur-xs"
            />
          )}
        </AnimatePresence>

        {/* ── LEFT SIDEBAR: SESSION HISTORY ── */}
        <AnimatePresence initial={false}>
          {isSidebarOpen && (
            <motion.aside
              key="session-sidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              className="absolute lg:static inset-y-0 left-0 z-50 lg:z-10 bg-white/95 backdrop-blur-md border-r border-zinc-200/80 flex flex-col min-h-0 overflow-hidden shadow-2xl lg:shadow-none"
              style={{ width: 280 }}
            >
              {/* Sidebar Header & Search */}
              <div className="p-3.5 border-b border-zinc-100 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold text-zinc-800 tracking-tight">Chat Sessions</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateNewSession}
                    className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors"
                    title="Start Fresh Chat"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={sessionSearch}
                    onChange={(e) => setSessionSearch(e.target.value)}
                    placeholder="Search history..."
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-blue-500 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none transition-all"
                  />
                </div>
              </div>

              {/* Sessions List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
                {filteredSessions.length === 0 ? (
                  <div className="p-4 text-center text-xs font-mono text-zinc-400">
                    No sessions found
                  </div>
                ) : (
                  filteredSessions.map((s) => {
                    const isActive = s.id === currentSessionId;
                    const isEditing = s.id === editingSessionId;

                    return (
                      <div
                        key={s.id}
                        onClick={() => handleSelectSession(s.id)}
                        className={`group relative rounded-xl p-2.5 transition-all cursor-pointer border text-left ${
                          isActive
                            ? "bg-blue-50/80 border-blue-300 text-blue-900 shadow-2xs"
                            : "bg-white hover:bg-zinc-50/80 border-transparent hover:border-zinc-200 text-zinc-700"
                        }`}
                      >
                        {isEditing ? (
                          <form onSubmit={(e) => handleSaveRename(s.id, e)} className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              autoFocus
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              className="flex-1 bg-white border border-blue-400 rounded px-2 py-0.5 text-xs text-zinc-900 focus:outline-none"
                            />
                            <button
                              type="submit"
                              className="p-1 text-blue-600 hover:bg-blue-100 rounded"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSessionId(null)}
                              className="p-1 text-zinc-400 hover:text-zinc-600 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={`text-xs font-semibold truncate ${isActive ? "text-blue-900 font-bold" : "text-zinc-800"}`}>
                                {s.title}
                              </span>

                              {/* Actions on Hover */}
                              <div className="hidden group-hover:flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => handleStartRename(s, e)}
                                  className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200 transition-colors"
                                  title="Rename session"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteSession(s.id, e)}
                                  className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                  title="Delete session"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center justify-between mt-1 text-[10px] font-mono text-zinc-400">
                              <span className="flex items-center gap-1">
                                <Clock className="w-2.5 h-2.5" />
                                {formatSessionDate(s.updatedAt)}
                              </span>
                              <span>{s.messages.length} msg{s.messages.length === 1 ? "" : "s"}</span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Sidebar Footer */}
              <div className="p-3 border-t border-zinc-100 flex items-center justify-between text-[11px] font-mono text-zinc-500">
                <span>{sessions.length} Saved Thread{sessions.length === 1 ? "" : "s"}</span>
                <button
                  type="button"
                  onClick={handleCreateNewSession}
                  className="text-blue-600 hover:underline font-semibold"
                >
                  + New
                </button>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ── CENTER WORKSPACE ── */}
        <div className="flex-1 flex flex-col bg-zinc-50/50 min-h-0 overflow-hidden">
          {/* Sub-Header Tabs */}
          <div className="h-12 bg-white/90 backdrop-blur-md border-b border-zinc-200/80 px-3 sm:px-6 flex items-center justify-between shrink-0 gap-2 overflow-x-auto scrollbar-none">
            <div className="flex items-center gap-1 bg-zinc-100/80 p-1 rounded-xl border border-zinc-200/80 shrink-0">
              <button
                onClick={() => setActiveTab("chat")}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  activeTab === "chat"
                    ? "bg-white text-blue-600 shadow-2xs border border-zinc-200/80"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                <span>AI Assistant</span>
              </button>
              <button
                onClick={() => setActiveTab("rules")}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  activeTab === "rules"
                    ? "bg-white text-blue-600 shadow-2xs border border-zinc-200/80"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                <span>Rules</span>
                {extractedRules.length > 0 && (
                  <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200">
                    {extractedRules.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab("connectors")}
                className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  activeTab === "connectors"
                    ? "bg-white text-blue-600 shadow-2xs border border-zinc-200/80"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                <Plug className="w-3.5 h-3.5 text-blue-600" />
                <span>MCP Tools</span>
                <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-blue-50 text-blue-700 font-bold border border-blue-200">
                  {CONNECTORS.length - 1}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <button
                type="button"
                onClick={toggleVoiceMode}
                className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-2xs border whitespace-nowrap ${
                  isVoiceMode
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white border-blue-500 shadow-blue-500/20 font-bold"
                    : "bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border-zinc-200"
                }`}
              >
                <Radio className={`w-3.5 h-3.5 ${isVoiceMode ? "text-white animate-pulse" : "text-zinc-500"}`} />
                <span>Voice {isVoiceMode ? "ON" : "OFF"}</span>
              </button>

              <div className="text-xs font-mono text-zinc-500 hidden xl:flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Auto-Searching {documents.length} Indexed Docs</span>
              </div>
            </div>
          </div>

          {/* TAB 1: CHAT */}
          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col min-h-0 bg-white">
              <div className="flex-1 overflow-y-auto scrollbar-thin p-4 sm:p-6 space-y-4 bg-zinc-50/40">
                <div className={`mx-auto space-y-4 ${activeSource ? "max-w-2xl" : "max-w-2xl lg:max-w-3xl 2xl:max-w-5xl"}`}>
                  <VoiceModePanel
                    isVoiceMode={isVoiceMode}
                    isRecording={isRecording}
                    isSpeaking={isSpeaking}
                    recordingTime={recordingTime}
                    voiceError={voiceError}
                    onToggleRecord={isRecording ? stopRecording : startRecording}
                    onStopSpeaking={() => speakText("")}
                  />
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      ref={(el) => { messageRefs.current[msg.id] = el; }}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[92%] sm:max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                        <div className="text-[10px] font-mono font-bold text-zinc-400 mb-1 px-1 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            {msg.role === "assistant" ? (
                              <>
                                <Bot className="w-3 h-3 text-blue-600" />
                                <span>AI AGENT</span>
                              </>
                            ) : (
                              <span>YOU</span>
                            )}
                          </span>
                          {msg.latencyMs && <span className="font-mono text-zinc-400">{msg.latencyMs}ms</span>}
                        </div>

                        {/* Multilingual Detection Badge */}
                        {msg.role === "assistant" && msg.detected_language && msg.detected_language !== "en" && (
                          <div className="mb-2 space-y-1 font-mono text-[11px]">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-800 border border-blue-200 font-bold">
                              <Globe className="w-3.5 h-3.5 text-blue-600" />
                              <span>Language: {msg.language_name || msg.detected_language.toUpperCase()} ({msg.detected_language})</span>
                            </div>
                          </div>
                        )}

                        <div className="flex items-start gap-2">
                          <div
                            className={`p-3.5 sm:p-4 rounded-2xl text-[13px] leading-relaxed shadow-xs flex-1 ${
                              msg.role !== "assistant"
                                ? "bg-blue-600 text-white font-medium font-sans whitespace-pre-wrap"
                                : msg.isError
                                ? "bg-red-50 border border-red-200 text-red-700 font-sans"
                                : "bg-white border border-zinc-200 text-zinc-800 font-sans"
                            }`}
                          >
                            {msg.role === "assistant" && !msg.isError ? <ChatMarkdown content={msg.content} /> : msg.content}
                          </div>
                          {msg.role === "assistant" && !msg.isError && (
                            <button
                              type="button"
                              onClick={() => speakText(msg.content, msg.id)}
                              className={`p-2 rounded-xl border text-zinc-500 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0 ${
                                activeSpeechMsgId === msg.id && isSpeaking ? "text-purple-600 bg-purple-50 border-purple-200" : "bg-white border-zinc-200"
                              }`}
                              title="Listen to Voice Response"
                            >
                              {activeSpeechMsgId === msg.id && isSpeaking ? (
                                <VolumeX className="w-4 h-4 text-purple-600 animate-pulse" />
                              ) : (
                                <Volume2 className="w-4 h-4" />
                              )}
                            </button>
                          )}
                        </div>

                        {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {msg.sources.map((src, sIdx) =>
                              src.is_audio || src.timestamp_str ? (
                                <div
                                  key={sIdx}
                                  className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg shadow-2xs"
                                >
                                  <FileAudio className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Audio Timestamp {src.timestamp_str || `[Page ${src.page}]`}</span>
                                </div>
                              ) : !src.document_id ? (
                                <a
                                  key={sIdx}
                                  href={src.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 px-3 py-1 rounded-lg transition-colors shadow-2xs max-w-[220px] truncate"
                                  title={src.url}
                                >
                                  <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                  <span className="truncate">{src.title || src.url || "Web source"}</span>
                                </a>
                              ) : (
                                <button
                                  key={sIdx}
                                  onClick={() => { setActiveSource(src); setActiveSourceMsgId(msg.id); }}
                                  className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1 rounded-lg transition-colors shadow-2xs"
                                  title={`Jump to ${documents.find((d) => d.id === src.document_id)?.fileName || `Doc ${src.document_id.slice(0, 8)}`}, page ${src.page ?? "?"}`}
                                >
                                  <Crosshair className="w-3.5 h-3.5 text-blue-600" />
                                  <span>
                                    Source {sIdx + 1}
                                    {src.page ? ` · p.${src.page}` : ""}
                                  </span>
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}

                  <AgentLatencyAnimation
                    isLoading={isLoading}
                    didError={lastQueryFailed}
                    isTyping={!isLoading && input.trim().length > 0 && !isRecording}
                  />
                  <div ref={chatEndRef} />
                </div>
              </div>

              {/* Chat Input & Command Palette Menu */}
              <div className="p-3 sm:p-4 bg-white border-t border-zinc-200/80 relative">
                <div className={`mx-auto relative ${activeSource ? "max-w-2xl" : "max-w-2xl lg:max-w-3xl 2xl:max-w-5xl"}`}>
                  {/* Add Link (Web Crawl) Popover */}
                  <AnimatePresence>
                    {showLinkInput && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        className="absolute bottom-full mb-3 left-0 right-0 bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden z-30 font-sans"
                      >
                        <div className="px-4 py-2.5 bg-zinc-50/90 border-b border-zinc-200/80 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Link2 className="w-3.5 h-3.5 text-blue-600" />
                            <span className="text-[11px] font-mono font-bold text-zinc-800 uppercase tracking-wider">
                              Crawl a Link into the Index
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setShowLinkInput(false); setLinkInputValue(""); }}
                            className="p-1 rounded hover:bg-zinc-200 text-zinc-500 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <form onSubmit={handleUrlUpload} className="p-3 flex gap-2 items-center">
                          <input
                            type="text"
                            autoFocus
                            value={linkInputValue}
                            onChange={(e) => setLinkInputValue(e.target.value)}
                            placeholder="https://company.com/policy-page"
                            disabled={isCrawlingLink}
                            className="flex-1 bg-zinc-50 border border-zinc-200 focus:border-blue-500 rounded-xl px-3 py-2 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none transition-all disabled:opacity-60"
                          />
                          <button
                            type="submit"
                            disabled={isCrawlingLink || !linkInputValue.trim()}
                            className="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors disabled:opacity-40 shrink-0 flex items-center gap-1.5"
                          >
                            {isCrawlingLink ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                            <span>{isCrawlingLink ? "Crawling..." : "Crawl"}</span>
                          </button>
                        </form>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* HARMONIZED LIGHT COMMAND PALETTE MENU */}
                  <AnimatePresence>
                    {showSlashMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.98 }}
                        className="absolute bottom-full mb-3 left-0 right-0 bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden z-30 max-h-72 flex flex-col font-sans"
                      >
                        <div className="px-4 py-2.5 bg-zinc-50/90 border-b border-zinc-200/80 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Command className="w-3.5 h-3.5 text-blue-600" />
                            <span className="text-[11px] font-mono font-bold text-zinc-800 uppercase tracking-wider">
                              Command Palette / MCP Tools
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-100 border border-zinc-200 text-zinc-600">
                              ↵ Select
                            </span>
                          </div>
                        </div>

                        <div className="overflow-y-auto p-2 space-y-1 flex-1 scrollbar-thin">
                          {filteredCommands.length === 0 ? (
                            <div className="p-4 text-xs font-mono text-zinc-400 text-center">
                              No matching tools found
                            </div>
                          ) : (
                            filteredCommands.map((c) => {
                              const Icon = c.icon;
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => applySlashCommand(c)}
                                  className="w-full text-left p-2.5 rounded-xl flex items-center justify-between hover:bg-blue-50/70 transition-all border border-transparent hover:border-blue-200 group"
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${c.color}`}>
                                      <Icon className="w-4 h-4" />
                                    </div>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold font-mono text-blue-600">
                                          {c.command}
                                        </span>
                                        <span className="text-xs font-semibold text-zinc-900 truncate">
                                          {c.name}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                                        {c.desc}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0 ml-3">
                                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                                      {c.agenticLabel}
                                    </span>
                                    <CornerDownLeft className="w-3.5 h-3.5 text-zinc-400 group-hover:text-blue-600 transition-colors" />
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {isDocIndexing && (
                    <div className="mb-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] font-mono text-amber-800 flex items-center gap-2 shadow-xs">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-amber-600" />
                      <span>
                        <span className="font-semibold">{currentFileName || "This document"}</span> is still being
                        indexed. You can ask questions once processing is complete.
                      </span>
                    </div>
                  )}
                  {docStatus === "failed" && (
                    <div className="mb-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-[11px] font-mono text-red-800 flex items-center gap-2 shadow-xs">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
                      <span className="flex-1">
                        Indexing <span className="font-semibold">{currentFileName || "this document"}</span> failed
                        {docError ? `: ${docError}` : "."}
                      </span>
                      <button
                        type="button"
                        onClick={() => currentDocId && retryDocument(currentDocId)}
                        disabled={isRetryingDoc || !currentDocId}
                        className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold transition-colors disabled:opacity-40 shrink-0"
                      >
                        {isRetryingDoc ? "Retrying..." : "Retry"}
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="flex gap-1.5 sm:gap-2 items-center">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".pdf,.mp3,.wav,.m4a,.ogg,.flac,.aac,.webm,.wma,application/pdf,audio/*"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-zinc-100 hover:bg-blue-50 text-zinc-700 hover:text-blue-600 border border-zinc-200 hover:border-blue-200 flex items-center justify-center transition-all disabled:opacity-40 shrink-0"
                      title="Upload a document or audio file"
                    >
                      {isUploading ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-blue-600" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowLinkInput((prev) => !prev)}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-all shrink-0 border ${
                        showLinkInput
                          ? "bg-blue-50 text-blue-600 border-blue-200"
                          : "bg-zinc-100 hover:bg-blue-50 text-zinc-700 hover:text-blue-600 border-zinc-200 hover:border-blue-200"
                      }`}
                      title="Crawl a link into the index"
                    >
                      <Link2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>

                    <div className="relative flex-1 min-w-0">
                      <input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Ask a question, upload doc, or type '/'..."
                        className="w-full bg-zinc-50 border border-zinc-200 focus:border-blue-500 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none transition-all shadow-inner font-sans"
                        disabled={isLoading}
                      />
                      {input.startsWith("/") && (
                        <span className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-md font-bold pointer-events-none items-center gap-1 shadow-2xs">
                          <Terminal className="w-3 h-3 text-blue-600" /> Command Mode
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center transition-all shrink-0 border ${
                        isRecording
                          ? "bg-red-600 hover:bg-red-700 text-white border-red-500 animate-pulse shadow-md shadow-red-500/30"
                          : "bg-zinc-100 hover:bg-blue-50 text-zinc-700 hover:text-blue-600 border-zinc-200 hover:border-blue-200"
                      }`}
                      title={isRecording ? "Stop Voice Recording" : "Record Voice Query"}
                    >
                      {isRecording ? <Square className="w-4 h-4 sm:w-5 sm:h-5" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </button>

                    <button
                      type="submit"
                      disabled={isLoading || !input.trim() || isDocIndexing}
                      title={isDocIndexing ? "Document is still indexing — please wait" : undefined}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shadow-md shadow-blue-600/20 transition-all disabled:opacity-40 shrink-0"
                    >
                      <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: EXTRACTED RULES */}
          {activeTab === "rules" && (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-zinc-50/40">
              <div className="max-w-2xl mx-auto space-y-3">
                {isDocIndexing && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-mono text-amber-800 flex items-center gap-2 shadow-xs">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0 text-amber-600" />
                    <span className="font-semibold">
                      {docStatus === "uploaded" ? "Queued for indexing..." : "Extracting vector rules..."}
                    </span>
                  </div>
                )}

                {docStatus === "failed" && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-mono text-red-800 flex items-center gap-2 shadow-xs">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span className="flex-1">
                      Indexing failed{docError ? `: ${docError}` : "."}
                    </span>
                    <button
                      type="button"
                      onClick={() => currentDocId && retryDocument(currentDocId)}
                      disabled={isRetryingDoc || !currentDocId}
                      className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold transition-colors disabled:opacity-40 shrink-0"
                    >
                      {isRetryingDoc ? "Retrying..." : "Retry"}
                    </button>
                  </div>
                )}

                {isDocIndexing && extractedRules.length === 0 && (
                  <div className="space-y-3" aria-hidden="true">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="bg-white border border-zinc-200 rounded-xl p-3 shadow-xs animate-pulse"
                      >
                        <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-zinc-100">
                          <div className="h-4 w-16 rounded bg-zinc-200" />
                          <div className="h-4 w-10 rounded bg-zinc-100" />
                        </div>
                        <div className="h-3 w-full rounded bg-zinc-100 mb-1.5" />
                        <div className="h-3 w-4/5 rounded bg-zinc-100" />
                      </div>
                    ))}
                  </div>
                )}

                {extractedRules.length === 0 && !isDocIndexing && docStatus !== "failed" && (
                  <div className="p-8 text-center border-2 border-dashed border-zinc-200 rounded-2xl bg-white">
                    <Search className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
                    <p className="text-xs font-semibold text-zinc-700">NO RULES EXTRACTED</p>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Upload a PDF in the chat to extract structured rules from it.
                    </p>
                  </div>
                )}

                <AnimatePresence>
                  {extractedRules.map((rule, index) => (
                    <motion.div
                      key={rule.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="bg-white border border-zinc-200 hover:border-blue-300 rounded-xl p-3 shadow-xs hover:shadow transition-all"
                    >
                      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-zinc-100">
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 uppercase">
                          {rule.type || "RULE"}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500 border border-zinc-200 px-1.5 py-0.5 rounded bg-zinc-50">
                          {rule.confidence || 98}%
                        </span>

                        {rule.bbox && rule.page_dim && rule.page && rule.document_id && (
                          <button
                            onClick={() => {
                              setActiveSourceMsgId(null);
                              setActiveSource({
                                document_id: rule.document_id!,
                                page: rule.page!,
                                bbox: rule.bbox,
                                page_dim: rule.page_dim,
                              });
                            }}
                            className="ml-auto text-[10px] font-mono flex items-center gap-1 bg-zinc-100 hover:bg-blue-600 hover:text-white text-zinc-700 px-2 py-1 rounded border border-zinc-200 transition-colors shadow-2xs"
                            title="View Bounding Box Target in PDF"
                          >
                            <Crosshair className="w-3.5 h-3.5 text-blue-600 group-hover:text-white" />
                            <span>Target</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-zinc-800 leading-relaxed font-medium">
                        {rule.canonical_rule}
                      </p>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={rulesEndRef} />
              </div>
            </div>
          )}

          {/* TAB 3: CONNECTORS SECTION */}
          {activeTab === "connectors" && (
            <div className="flex-1 overflow-y-auto p-4 sm:p-8 max-w-6xl mx-auto w-full">
              <div className="mb-6 sm:mb-8">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold mb-3">
                  <Plug className="w-3.5 h-3.5 text-blue-600" />
                  <span>Agentic MCP Server Registry</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight">
                  Integrated MCP Tool Connectors
                </h2>
                <p className="text-xs text-zinc-500 mt-1 max-w-xl">
                  Connect third-party enterprise tools. Type slash commands (e.g. <code className="font-mono text-blue-700 bg-blue-50 border border-blue-200 px-1 rounded">/slack</code>, <code className="font-mono text-blue-700 bg-blue-50 border border-blue-200 px-1 rounded">/github</code>) in chat to query them directly.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {CONNECTORS.filter((c) => c.id !== "connectors").map((c) => {
                  const Icon = c.icon;
                  return (
                    <motion.div
                      key={c.id}
                      whileHover={{ y: -2 }}
                      className="bg-white border border-zinc-200/80 hover:border-blue-300 rounded-2xl p-4 sm:p-5 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${c.color}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <span
                            className={`text-[10px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${
                              c.status === "Connected"
                                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-zinc-100 text-zinc-600 border-zinc-200"
                            }`}
                          >
                            {c.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-sm text-zinc-900">{c.name}</h3>
                          <span className="text-[10px] font-mono text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded font-bold">
                            {c.command}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-zinc-400 block mb-2">
                          {c.agenticLabel} • {c.category}
                        </span>
                        <p className="text-xs text-zinc-600 leading-relaxed">{c.desc}</p>
                      </div>

                      <div className="mt-5 pt-3 border-t border-zinc-100 flex items-center justify-between">
                        <span className="text-[11px] font-mono text-zinc-500 truncate mr-2">
                          {c.agentAction}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("chat");
                            setInput(`${c.command} `);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-blue-600 text-white text-xs font-semibold transition-colors flex items-center gap-1 shadow-2xs shrink-0"
                        >
                          <span>Execute</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── SLIDE-OVER: PDF SOURCE INSPECTOR ── */}
        <AnimatePresence>
          {activeSource && (
            <motion.div
              key="pdf-inspector-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveSource(null)}
              className="absolute inset-0 z-40 bg-zinc-900/40 lg:bg-transparent"
              aria-hidden="true"
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {activeSource && (
            <motion.div
              key="pdf-inspector-panel"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ duration: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-y-0 right-0 z-50 w-full sm:w-[480px] lg:static lg:inset-auto lg:z-auto lg:w-[38%] shrink-0 bg-white border-l border-zinc-200 flex flex-col overflow-hidden shadow-xl"
            >
              <div className="h-11 shrink-0 bg-zinc-50 border-b border-zinc-200 px-4 flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-800">PDF Source Inspector</span>
                <button
                  onClick={() => setActiveSource(null)}
                  className="p-1 rounded hover:bg-zinc-200 text-zinc-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-hidden relative">
                <PdfViewer
                  source={activeSource}
                  fileName={activeSourceFileName}
                  notFound={activeSourceNotFound}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VOICE MODE PANEL
   ═══════════════════════════════════════════════════════════ */

function VoiceModePanel({
  isVoiceMode,
  isRecording,
  isSpeaking,
  recordingTime,
  voiceError,
  onToggleRecord,
  onStopSpeaking,
}: {
  isVoiceMode: boolean;
  isRecording: boolean;
  isSpeaking: boolean;
  recordingTime: number;
  voiceError: string | null;
  onToggleRecord: () => void;
  onStopSpeaking: () => void;
}) {
  const state: "recording" | "speaking" | "idle" = isRecording ? "recording" : isSpeaking ? "speaking" : "idle";

  const accent = {
    recording: { button: "bg-red-600 hover:bg-red-700", ring: "border-red-300", dot: "bg-red-500", bar: "bg-red-400" },
    speaking: { button: "bg-blue-600 hover:bg-blue-700", ring: "border-blue-300", dot: "bg-blue-600", bar: "bg-blue-400" },
    idle: { button: "bg-zinc-900 hover:bg-blue-600", ring: "border-blue-200", dot: "bg-emerald-500", bar: "bg-zinc-200" },
  }[state];

  const barHeights = [7, 12, 18, 12, 16, 9, 13];

  return (
    <AnimatePresence>
      {isVoiceMode && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          className="relative bg-gradient-to-br from-white via-blue-50/40 to-white border border-blue-200/70 rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6 shadow-sm overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100/50 rounded-bl-full blur-2xl pointer-events-none" />

          <div className="relative flex items-center gap-3 sm:gap-4">
            {/* Mic Button */}
            <div className="relative shrink-0">
              <motion.div
                animate={{ opacity: state === "idle" ? [0.4, 0.1, 0.4] : [0.7, 0.25, 0.7] }}
                transition={{ repeat: Infinity, duration: state === "recording" ? 1.1 : 2.2 }}
                className={`absolute -inset-2 rounded-full border ${accent.ring}`}
              />
              <button
                type="button"
                onClick={onToggleRecord}
                className={`relative z-10 w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center text-white shadow-md transition-all ${accent.button}`}
                title={isRecording ? "Stop Recording" : "Start Voice Query"}
              >
                {isRecording ? (
                  <Square className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : isSpeaking ? (
                  <Volume2 className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse" />
                ) : (
                  <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </button>
            </div>

            {/* Status + Waveform */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-1.5 h-1.5 rounded-full ${accent.dot} ${state !== "idle" ? "animate-pulse" : ""}`} />
                <span className="text-[11px] sm:text-xs font-mono font-bold uppercase tracking-wider text-zinc-900 truncate">
                  {isRecording ? `Listening · ${recordingTime}s` : isSpeaking ? "Speaking Response" : "Voice Mode Active"}
                </span>
              </div>

              <div className="flex items-end gap-1 h-4 sm:h-5 mb-1">
                {barHeights.map((h, i) => (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all duration-300 ${state === "idle" ? "" : "animate-pulse"} ${accent.bar}`}
                    style={{ height: state === "idle" ? 4 : h, animationDelay: `${i * 90}ms` }}
                  />
                ))}
              </div>

              <p className="text-[10px] sm:text-[11px] text-zinc-500 leading-relaxed truncate">
                {isRecording
                  ? "Click again to stop and send."
                  : isSpeaking
                  ? "Reading the answer aloud."
                  : "Click mic to speak."}
              </p>
            </div>

            {isSpeaking && (
              <button
                type="button"
                onClick={onStopSpeaking}
                className="shrink-0 text-[10px] sm:text-[11px] font-mono font-bold text-blue-600 hover:text-blue-700 border border-blue-200 hover:bg-blue-50 px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors"
              >
                Stop
              </button>
            )}
          </div>

          {voiceError && (
            <div className="relative mt-3 pt-2.5 border-t border-zinc-100 flex items-center gap-2 text-[11px] font-mono text-red-600">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{voiceError}</span>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
