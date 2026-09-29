/**
 * Plays one utterance that arrives as a sequence of audio chunks (the
 * interview WebSocket's tts_chunk messages, one per sentence), starting as
 * soon as the first chunk is decoded instead of waiting for the whole reply.
 *
 * - Ordering: chunks are decoded through a promise chain, so a short chunk
 *   that decodes fast can never play before an earlier, longer one.
 * - No overlap: one utterance at a time; begin() stops whatever was playing,
 *   and each chunk is scheduled back-to-back on the AudioContext clock.
 * - Cancellation: stop() (barge-in / end call) halts playback immediately and
 *   drops chunks still decoding or not yet received for that utterance.
 * - Accepts WAV (Kokoro) or MP3 (fallback) — decodeAudioData handles both.
 */

export type SpeechOutcome = "completed" | "interrupted";

export class StreamingSpeechPlayer {
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private generation = 0;
  private decodeChain: Promise<void> = Promise.resolve();
  private nextStartAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private queued = 0;
  private finished = false;
  private resolveDone: ((o: SpeechOutcome) => void) | null = null;
  private safetyTimer: number | null = null;
  private onFirstAudio: (() => void) | null = null;

  /** Create/resume the AudioContext. Call from a user gesture (e.g. the
   * Start Interview click) so the browser's autoplay policy allows audio. */
  unlock(): void {
    const ctx = this.context();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  }

  get analyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  get isPlaying(): boolean {
    return this.resolveDone !== null;
  }

  /** Starts a new utterance; resolves once every chunk has played after
   * finish() (or immediately with "interrupted" on stop()). */
  begin(maxDurationMs = 120000, onFirstAudio?: () => void): Promise<SpeechOutcome> {
    this.stop();
    this.onFirstAudio = onFirstAudio ?? null;
    const ctx = this.context();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    this.finished = false;
    this.queued = 0;
    this.nextStartAt = 0;
    const done = new Promise<SpeechOutcome>((resolve) => {
      this.resolveDone = resolve;
    });
    // Never leave the interview stuck in "speaking" if a stream stalls.
    this.safetyTimer = window.setTimeout(() => this.settle("completed"), maxDurationMs);
    return done;
  }

  push(audio: ArrayBuffer): void {
    if (!this.resolveDone) return;
    const gen = this.generation;
    const ctx = this.context();
    this.queued += 1;
    this.decodeChain = this.decodeChain
      .then(() => ctx.decodeAudioData(audio))
      .then((buffer) => {
        if (gen !== this.generation) return;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.analyserNode!);
        const startAt = Math.max(ctx.currentTime + 0.02, this.nextStartAt);
        this.nextStartAt = startAt + buffer.duration;
        src.onended = () => {
          this.sources.delete(src);
          if (gen === this.generation) this.chunkDone();
        };
        this.sources.add(src);
        src.start(startAt);
        const notify = this.onFirstAudio;
        if (notify) {
          // Fires when the first sample is actually due at the speakers, not
          // when the chunk arrived — the number latency metrics should use.
          this.onFirstAudio = null;
          window.setTimeout(() => {
            if (gen === this.generation) notify();
          }, Math.max(0, (startAt - ctx.currentTime) * 1000));
        }
      })
      .catch(() => {
        // An undecodable chunk is skipped, not fatal to the utterance.
        if (gen === this.generation) this.chunkDone();
      });
  }

  /** No more chunks are coming for this utterance. */
  finish(): void {
    this.finished = true;
    if (this.queued === 0) this.settle("completed");
  }

  stop(): void {
    this.generation += 1;
    this.onFirstAudio = null;
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {}
    }
    this.sources.clear();
    this.queued = 0;
    this.settle("interrupted");
  }

  close(): void {
    this.stop();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyserNode = null;
  }

  private chunkDone(): void {
    this.queued = Math.max(0, this.queued - 1);
    if (this.finished && this.queued === 0) this.settle("completed");
  }

  private settle(outcome: SpeechOutcome): void {
    if (this.safetyTimer !== null) {
      window.clearTimeout(this.safetyTimer);
      this.safetyTimer = null;
    }
    const resolve = this.resolveDone;
    this.resolveDone = null;
    resolve?.(outcome);
  }

  private context(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 64;
      this.analyserNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
