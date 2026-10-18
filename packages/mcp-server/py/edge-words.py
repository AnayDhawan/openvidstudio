#!/usr/bin/env python3
"""Synthesize one line with edge-tts and write its word timings next to the audio.

generate_narration calls this for the edge-tts engine. The edge-tts command line only writes
sentence-level subtitles (version 7), so word boundaries come from the library's own stream:
Microsoft's service sends a WordBoundary event per word with its offset and duration, in
100-nanosecond ticks, and this writes them as [{ "word", "startMs", "endMs" }] in the clip as
synthesized. generate_narration then scales them if it stretches the clip.

    edge-words.py --voice en-US-AndrewNeural --text "..." --out clip.raw --words clip.words.json
"""

import argparse
import asyncio
import json
import sys

import edge_tts


async def synthesize(voice, text, out, words_path):
    try:
        communicate = edge_tts.Communicate(text, voice, boundary="WordBoundary")
    except TypeError:
        # edge-tts before 7 had no `boundary` argument and always sent word boundaries.
        communicate = edge_tts.Communicate(text, voice)
    words = []
    with open(out, "wb") as audio:
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] // 10000
                words.append({"word": chunk["text"], "startMs": start, "endMs": start + chunk["duration"] // 10000})
    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(words, f)
    return len(words)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice", required=True)
    parser.add_argument("--text", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--words", required=True)
    args = parser.parse_args()
    try:
        count = asyncio.run(synthesize(args.voice, args.text, args.out, args.words))
    except Exception as err:  # the caller falls back to the plain command line and says so
        print(f"edge-words: {err}", file=sys.stderr)
        return 1
    print(count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
