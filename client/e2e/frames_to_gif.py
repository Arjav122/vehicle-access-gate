"""Turn the frames captured by e2e/demo.spec.ts into docs/assets/demo.gif.

    ..\\anpr\\.venv\\Scripts\\python e2e\\frames_to_gif.py      (from client/; needs Pillow)

Each frame gets a caption bar; phone screenshots are centred on a dark 1280x720 canvas.
Nothing is drawn that the app did not show: the pictures are the app's own screenshots.
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FRAMES = HERE.parent / "test-results" / "demo-frames"
OUT = HERE.parent.parent / "docs" / "assets" / "demo.gif"
WIDTH, HEIGHT, BAR = (
    960,
    540,
    44,
)  # README-friendly size; the bar sits below the picture


def font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    for name in (
        "IBMPlexSans-Medium.ttf",
        "segoeui.ttf",
        "arial.ttf",
        "DejaVuSans.ttf",
    ):
        for folder in (
            Path("C:/Windows/Fonts"),
            Path("/usr/share/fonts/truetype/dejavu"),
        ):
            try:
                return ImageFont.truetype(str(folder / name), size)
            except OSError:
                continue
    return ImageFont.load_default()


def render(item: dict, caption_font) -> Image.Image:
    shot = Image.open(FRAMES / item["file"]).convert("RGB")
    canvas = Image.new("RGB", (WIDTH, HEIGHT + BAR), (11, 13, 18))
    if item.get("phone"):
        scale = HEIGHT / shot.height
        shot = shot.resize((round(shot.width * scale), HEIGHT), Image.LANCZOS)
        canvas.paste(shot, ((WIDTH - shot.width) // 2, 0))
    else:
        canvas.paste(shot.resize((WIDTH, HEIGHT), Image.LANCZOS), (0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle(
        (0, HEIGHT, WIDTH, HEIGHT + BAR), fill=(31, 79, 184)
    )  # IND-strip blue
    draw.text(
        (16, HEIGHT + BAR // 2),
        item["caption"],
        fill="white",
        font=caption_font,
        anchor="lm",
    )
    return canvas


def main() -> int:
    manifest = FRAMES / "frames.json"
    if not manifest.exists():
        print("No frames: run `npm run demo:frames` first.", file=sys.stderr)
        return 1
    items = json.loads(manifest.read_text(encoding="utf-8"))
    caption_font = font(17)
    images = [render(i, caption_font) for i in items]
    # A palette per frame: the dark guard console and the light phone screen share few colours,
    # and one shared palette turned the green Approve button grey.
    frames = [
        im.quantize(
            colors=192, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
        )
        for im in images
    ]
    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=[i["ms"] for i in items],
        loop=0,
        optimize=True,
    )
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, {len(frames)} frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
