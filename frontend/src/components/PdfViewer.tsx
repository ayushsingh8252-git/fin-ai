"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, Crosshair, AlertTriangle, ExternalLink, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { getApiBaseUrl } from "@/lib/apiConfig";
import { useAuthedBlobUrl } from "@/lib/useAuthedBlobUrl";

type Source = {
  document_id?: string;
  page?: number;
  bbox?: number[];
  page_dim?: number[];
};

export default function PdfViewer({
  source,
  fileName,
  notFound,
}: {
  source: Source;
  fileName: string | null;
  notFound?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(450);
  // /uploads is login-protected, and an <iframe> can't send the auth header.
  const fileUrl = fileName && source?.document_id ? `${getApiBaseUrl()}/uploads/${fileName}` : null;
  const { src: pdfUrl, loading: pdfLoading } = useAuthedBlobUrl(fileUrl);

  useEffect(() => {
    if (containerRef.current) {
      const observer = new ResizeObserver((entries) => {
        for (let entry of entries) {
          if (entry.contentRect.width > 0) {
            setContainerWidth(Math.max(280, entry.contentRect.width));
          }
        }
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }
  }, []);

  if (!source || !source.document_id) {
    return (
      <div className="p-8 text-center font-mono text-xs text-zinc-500 flex flex-col items-center justify-center h-full bg-zinc-50">
        <Crosshair className="w-6 h-6 text-zinc-400 mb-2" />
        <span className="font-bold">SELECT RULE TARGET TO INSPECT BOUNDING BOX</span>
        <p className="text-[11px] text-zinc-400 mt-1 max-w-xs">
          Click "Target" on any extracted rule in the sidebar to highlight PDF coordinates.
        </p>
      </div>
    );
  }


  const bboxText = source.bbox ? `[${source.bbox.map(n => Math.round(n)).join(", ")}]` : null;

  const getHighlightOverlayStyle = () => {
    if (!source.bbox || !source.page_dim) return undefined;
    const [origW] = source.page_dim;
    const [bx, by, bw, bh] = source.bbox;
    const scale = containerWidth / (origW || 600);

    return {
      position: "absolute" as const,
      left: `${bx * scale}px`,
      top: `${by * scale}px`,
      width: `${bw * scale}px`,
      height: `${bh * scale}px`,
      backgroundColor: "rgba(37, 99, 235, 0.22)",
      border: "2px solid #2563EB",
      boxShadow: "0 0 16px rgba(37,99,235,0.4)",
      borderRadius: "6px",
      zIndex: 30,
      pointerEvents: "none" as const,
    };
  };

  return (
    <div className="flex flex-col h-full w-full bg-zinc-900 relative font-sans text-xs overflow-hidden">
      {/* Top Inspector Header */}
      <div className="p-3 border-b border-zinc-800 bg-zinc-950 flex justify-between items-center shrink-0 text-white">
        <div className="flex items-center gap-2 font-bold min-w-0">
          <FileText className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="truncate text-xs text-zinc-200">
            {fileName || `Doc ID: ${source.document_id}`}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {source.page && (
            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-mono text-[11px] font-bold">
              PAGE {source.page}
            </span>
          )}

          {bboxText && (
            <span className="hidden sm:inline px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono text-[10px]">
              BBOX: {bboxText}
            </span>
          )}

          {pdfUrl && (
            <a
              href={`${pdfUrl}#page=${source.page || 1}`}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors"
              title="Open PDF in New Window"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Main Viewer Body */}
      <div className="flex-1 overflow-hidden relative flex flex-col" ref={containerRef}>
        {pdfLoading ? (
          <div className="flex h-full items-center justify-center font-mono text-xs text-zinc-400">Loading PDF…</div>
        ) : pdfUrl ? (
          <div className="w-full h-full relative">
            {/* Native Embedded PDF Container */}
            <iframe
              src={`${pdfUrl}#page=${source.page || 1}&toolbar=1&navpanes=0`}
              className="w-full h-full border-0 bg-white"
              title="PDF Document Viewer"
            />

            {/* Optional Bounding Box Overlay Marker */}
            {source.bbox && (
              <div style={getHighlightOverlayStyle()} className="pointer-events-none">
                <span className="absolute -top-5 left-0 bg-blue-600 text-white text-[9px] font-mono px-1.5 py-0.2 rounded shadow-sm">
                  Target Bounding Vector
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="p-8 text-center font-mono text-xs text-amber-400 bg-amber-950/40 m-4 rounded-xl border border-amber-800/60 flex flex-col items-center justify-center h-full">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-amber-400" />
            {notFound ? (
              <>
                <span>SOURCE DOCUMENT NOT IN THIS SESSION</span>
                <p className="text-[10px] text-amber-400/70 mt-1 max-w-xs normal-case">
                  This citation points at a document ({source.document_id?.slice(0, 8) ?? "unknown"}…) that
                  isn't loaded in this browser session. Re-upload it to inspect the bounding box.
                </p>
              </>
            ) : (
              <span>SESSION PDF FILE NOT FOUND ON BACKEND SERVER</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
