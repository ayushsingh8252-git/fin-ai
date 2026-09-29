"""Turns LLM text into something a TTS voice can read naturally, and splits it
into sentence-sized chunks so audio can start before the whole reply is
synthesized.

Deliberately regex-only (no LLM call, no spaCy): this sits on the voice
latency path, and formatting a typical interviewer line takes well under a
millisecond.
"""

import re
from typing import Iterator, List

# Markdown / structured-output noise that should never be read aloud.
_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_JSON_BLOCK = re.compile(r"(?s)^\s*[\[{].*[\]}]\s*$")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_URL = re.compile(r"https?://\S+|www\.\S+")
_CITATION = re.compile(r"\[(?:\d+(?:\s*[,-]\s*\d+)*|source[^\]]*|citation[^\]]*)\]", re.IGNORECASE)
# Word-boundary guarded so snake_case identifiers aren't read as emphasis.
_EMPHASIS = re.compile(r"(?<!\w)(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\1(?!\w)")
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.MULTILINE)
_BLOCKQUOTE = re.compile(r"^\s*>\s?", re.MULTILINE)
_BULLET = re.compile(r"^\s*(?:[-*+•]|\d+[.)])\s+", re.MULTILINE)
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}.*$", re.MULTILINE)
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002700-\U000027BF\U0001F000-\U0001F2FF]")

# Spoken forms. Kept small and unambiguous: espeak-ng already reads most
# plain words and digits correctly; these are the cases it gets wrong or
# reads letter-by-letter in a way that sounds robotic.
_ABBREVIATIONS = {
    r"\be\.g\.": "for example",
    r"\bi\.e\.": "that is",
    r"\betc\.": "et cetera",
    r"\bvs\.?": "versus",
    r"\bapprox\.": "approximately",
    r"\bDr\.": "Doctor",
    r"\bMr\.": "Mister",
    r"\bMrs\.": "Missus",
    r"\bMs\.": "Miz",
    r"\byrs?\b": "years",
    r"\bw/": "with ",
}
_MAGNITUDE = {"k": "thousand", "m": "million", "b": "billion"}


def _dollars(m: "re.Match[str]") -> str:
    amount, suffix = m.group(1), (m.group(2) or "").lower()
    scale = _MAGNITUDE.get(suffix, suffix)
    return f"{amount} {scale} dollars" if scale else f"{amount} dollars"


_SYMBOLS = [
    (re.compile(r"(\d)\s*%"), r"\1 percent"),
    (re.compile(r"\$(\d[\d,]*(?:\.\d+)?)(?:\s?([kKmMbB]|million|billion|thousand)\b)?"), _dollars),
    (re.compile(r"(\d)\s*[-–]\s*(\d)"), r"\1 to \2"),
    (re.compile(r"\s&\s"), " and "),
    (re.compile(r"\band/or\b", re.IGNORECASE), "and or"),
    (re.compile(r"(\d)\+(?=\s|$)"), r"\1 plus"),
]
# Tech terms an interviewer says a lot that espeak-ng reads wrongly.
_TERMS = {
    r"\bC\+\+": "C plus plus",
    r"\bC#": "C sharp",
    r"(?<!\w)\.NET\b": "dot net",
    r"\bNode\.js\b": "Node JS",
    r"\bNext\.js\b": "Next JS",
    r"\bUI/UX\b": "U I and U X",
}

# Sentence end: . ! ? ; (optionally followed by closing quotes/brackets) +
# whitespace. Requiring the whitespace is what keeps "3.14" / "Python 3.11"
# whole, including mid-stream when "3." and "14" arrive as separate tokens.
_SENTENCE_END = re.compile(r"(?<=[.!?;])[\"')\]]*\s+")
# A period after one of these (or after a single-letter initial) is not a
# sentence end. Checked against the raw word, before speech expansion.
_NON_TERMINAL = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
    "approx", "no", "inc", "ltd", "co", "corp", "dept", "est", "fig", "u.s", "a.m", "p.m",
}
# Soft split points for over-long sentences.
_CLAUSE_BREAK = re.compile(r"(?<=[,;:—])\s+")

# Merge fragments like "Sure!" into the next sentence, but let a short
# opener ("Thanks for that.") stand alone: the first chunk's length IS the
# time-to-first-audio, so merging it into a long question costs seconds.
MIN_CHUNK_CHARS = 12
MAX_CHUNK_CHARS = 220   # split run-ons at a clause boundary
# The first chunk is capped tighter: measured live, interviewer questions
# are often ONE long sentence ("Could you tell me about X, and how Y?"),
# which made time-to-first-audio the whole question's synthesis (~3.4 s on
# the dev CPU). Splitting it at its first natural pause brings that down to
# the opening clause's synthesis time.
FIRST_CHUNK_MAX_CHARS = 110
_FIRST_SPLIT_MIN_CHARS = 25  # never split off an opener shorter than this


def format_for_speech(text: str) -> str:
    """Strip markdown/JSON/code/citations and expand symbols so the text reads
    naturally. Meaning is preserved; nothing is summarized or reworded."""
    if not text:
        return ""
    t = text.strip()
    if _JSON_BLOCK.match(t):
        # A raw JSON object/array is never meant to be spoken.
        return ""
    t = _CODE_FENCE.sub(" ", t)
    t = _INLINE_CODE.sub(r"\1", t)
    t = _HTML_TAG.sub(" ", t)
    t = _MD_LINK.sub(r"\1", t)
    t = _URL.sub(" ", t)
    t = _CITATION.sub("", t)
    t = _TABLE_RULE.sub("", t)
    t = _HEADING.sub("", t)
    t = _BLOCKQUOTE.sub("", t)
    t = _EMPHASIS.sub(r"\2", t)
    t = _EMOJI.sub("", t)

    # Bullet lists -> one sentence per item, so the voice pauses between them
    # instead of running the items together.
    lines = []
    for line in t.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        is_item = bool(_BULLET.match(line))
        stripped = _BULLET.sub("", stripped).strip("| ").replace("|", ", ")
        if is_item and stripped and stripped[-1] not in ".!?:;,":
            stripped += "."
        lines.append(stripped)
    t = " ".join(lines)

    for pattern, spoken in _TERMS.items():
        t = re.sub(pattern, spoken, t)
    for pattern, spoken in _ABBREVIATIONS.items():
        t = re.sub(pattern, spoken, t, flags=re.IGNORECASE)
    for pattern, repl in _SYMBOLS:
        t = pattern.sub(repl, t)

    t = re.sub(r"[*_#`~<>{}\[\]\\]", " ", t)
    t = re.sub(r"\s+([,.!?;:])", r"\1", t)
    t = re.sub(r"([.!?]){2,}", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip()


def _split_long(sentence: str) -> List[str]:
    if len(sentence) <= MAX_CHUNK_CHARS:
        return [sentence]
    parts: List[str] = []
    current = ""
    for clause in _CLAUSE_BREAK.split(sentence):
        if current and len(current) + 1 + len(clause) > MAX_CHUNK_CHARS:
            parts.append(current)
            current = clause
        else:
            current = f"{current} {clause}".strip()
    if current:
        parts.append(current)
    # A single clause can still exceed the cap (no punctuation at all) —
    # hard-wrap at a word boundary as the last resort.
    out: List[str] = []
    for p in parts:
        while len(p) > MAX_CHUNK_CHARS:
            cut = p.rfind(" ", 0, MAX_CHUNK_CHARS)
            cut = cut if cut > 0 else MAX_CHUNK_CHARS
            out.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out.append(p)
    return out


class SentenceChunker:
    """Incremental sentence detector. Feed it text as it arrives (whole
    replies or LLM token deltas) and it yields speakable chunks as soon as a
    sentence is complete. Fragments shorter than MIN_CHUNK_CHARS are held and
    merged with the following sentence, so "Sure!" never becomes its own
    tiny, choppy audio clip."""

    def __init__(self, min_chars: int = MIN_CHUNK_CHARS):
        self.min_chars = min_chars
        self._buffer = ""
        self._held = ""
        self._emitted = False

    def _pieces(self, text: str) -> List[str]:
        if not self._emitted:
            self._emitted = True
            first = _split_first(text)
            return [first[0], *(_split_long(first[1]) if len(first) > 1 else [])]
        return _split_long(text)

    def feed(self, delta: str) -> Iterator[str]:
        self._buffer += delta
        pos = 0
        while True:
            m = _SENTENCE_END.search(self._buffer, pos)
            if not m:
                return
            if _is_false_boundary(self._buffer[: m.start()]):
                pos = m.end()
                continue
            sentence = self._buffer[: m.start()].strip()
            self._buffer = self._buffer[m.end():]
            pos = 0
            yield from self._emit(sentence)

    def flush(self) -> Iterator[str]:
        tail = self._buffer.strip()
        self._buffer = ""
        combined = f"{self._held} {tail}".strip()
        self._held = ""
        if combined:
            yield from self._pieces(combined)

    def _emit(self, sentence: str) -> Iterator[str]:
        if not sentence:
            return
        combined = f"{self._held} {sentence}".strip()
        if len(combined) < self.min_chars:
            self._held = combined
            return
        self._held = ""
        yield from self._pieces(combined)


def _is_false_boundary(before: str) -> bool:
    """True when the '.' ending `before` belongs to an abbreviation or an
    initial ("Dr.", "e.g.", "J. Smith") rather than ending a sentence."""
    if not before.endswith("."):
        return False
    word = before.rsplit(None, 1)[-1].lstrip("(\"'").rstrip(".").lower()
    return word in _NON_TERMINAL or (len(word) == 1 and word.isalpha() and word not in ("i", "a"))


def _split_first(sentence: str) -> List[str]:
    """Split an over-long opening sentence once, at its last clause break
    that keeps the opener within FIRST_CHUNK_MAX_CHARS. Clause breaks only
    (comma/semicolon/colon/dash) — they're where a speaker pauses anyway, so
    the split is inaudible. No suitable break: leave the sentence whole."""
    if len(sentence) <= FIRST_CHUNK_MAX_CHARS:
        return [sentence]
    cut = None
    for m in _CLAUSE_BREAK.finditer(sentence):
        if _FIRST_SPLIT_MIN_CHARS <= m.start() <= FIRST_CHUNK_MAX_CHARS:
            cut = m
    if cut is None:
        return [sentence]
    return [sentence[: cut.start()].strip(), sentence[cut.end():].strip()]


def speech_chunks(text: str) -> List[str]:
    """Format a complete reply and split it into ordered speakable chunks."""
    chunker = SentenceChunker()
    formatted = format_for_speech(text)
    return [*chunker.feed(formatted + " "), *chunker.flush()]
