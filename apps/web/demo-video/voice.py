"""Speak each scene's narration with a free neural voice and write how long each line is.

    uv run --with edge-tts --with mutagen python voice.py

The text is sent to Microsoft's speech service to be spoken (it needs internet). Nothing else leaves
this machine. Output: out/<scene>.mp3 and out/durations.json.
"""

import asyncio
import json
from pathlib import Path

import edge_tts
from mutagen.mp3 import MP3

HERE = Path(__file__).parent
OUT = HERE / "out"


async def main() -> None:
    story = json.loads((HERE / "story.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    durations: dict[str, float] = {}
    for scene in story["scenes"]:
        path = OUT / f"{scene['id']}.mp3"
        await edge_tts.Communicate(scene["narration"], story["voice"], rate=story["rate"]).save(
            str(path)
        )
        durations[scene["id"]] = round(MP3(str(path)).info.length, 2)
        print(f"{scene['id']:<11} {durations[scene['id']]:>5}s")
    (OUT / "durations.json").write_text(json.dumps(durations, indent=2), encoding="utf-8")
    print("total", round(sum(durations.values()), 1), "seconds of narration")


asyncio.run(main())
