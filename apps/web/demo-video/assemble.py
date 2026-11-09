"""Put each narration line at the start of its scene and write the finished MP4.

    uv run --with imageio-ffmpeg python assemble.py

Needs out/hr-story.webm and out/timeline.json (from record.mjs) and out/<scene>.mp3 (from voice.py).
Uses the ffmpeg binary that comes inside the imageio-ffmpeg package, so nothing is installed system-wide.
"""

import json
import subprocess
from pathlib import Path

import imageio_ffmpeg

HERE = Path(__file__).parent
OUT = HERE / "out"
SHIFT = 0.15  # seconds: the voice starts just after the scene does


def main() -> None:
    timeline = json.loads((OUT / "timeline.json").read_text(encoding="utf-8"))
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    scenes = list(timeline)
    inputs = ["-i", str(OUT / "hr-story.webm")]
    filters = []
    for n, scene in enumerate(scenes, start=1):
        inputs += ["-i", str(OUT / f"{scene}.mp3")]
        delay = int((timeline[scene]["start"] + SHIFT) * 1000)
        filters.append(f"[{n}:a]adelay={delay}|{delay}[a{n}]")
    mix = "".join(f"[a{n}]" for n in range(1, len(scenes) + 1))
    filters.append(f"{mix}amix=inputs={len(scenes)}:normalize=0,volume=1.0[voice]")
    target = OUT / "hr-story.mp4"
    command = [
        ffmpeg, "-y", *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "0:v", "-map", "[voice]", "-vf", "scale=1920:1080:flags=lanczos",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest",
        str(target),
    ]  # fmt: skip
    subprocess.run(command, check=True, capture_output=True)
    print("Wrote", target, round(target.stat().st_size / 1_000_000, 1), "MB")


main()
