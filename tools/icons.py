"""Ikonka i ekran startowy Szafy: kremowy papier, pikselowy wieszak, pomarańczowa metka."""
from PIL import Image, ImageDraw
import os
R = "app/android/app/src/main/res"
CREAM, INK, ORANGE = (242, 238, 227), (20, 20, 20), (242, 140, 40)
HANGER = [
 "......XX......",
 ".....X..X.....",
 "........X.....",
 ".......X......",
 "......X.......",
 ".....XXX......",
 "....X...X.....",
 "...X.....X....",
 "..X.......X...",
 ".X.........X..",
 "XXXXXXXXXXXXX.",
]
def draw(size, pad, bg=True, round_=False):
    im = Image.new("RGBA", (size, size), CREAM + (255,) if bg else (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    w = len(HANGER[0]); px = (size - 2 * pad) / w
    oy = (size - px * len(HANGER)) / 2 - px
    for y, row in enumerate(HANGER):
        for x, c in enumerate(row):
            if c == "X":
                d.rectangle([pad + x * px, oy + y * px, pad + (x + 1) * px - 1, oy + (y + 1) * px - 1], fill=INK)
    # metka
    tx, ty = pad + 9 * px, oy + 11.5 * px
    d.rectangle([tx, ty, tx + 3 * px, ty + 2 * px], fill=ORANGE)
    if round_:
        m = Image.new("L", (size, size), 0); ImageDraw.Draw(m).ellipse([0, 0, size - 1, size - 1], fill=255)
        im.putalpha(m)
    return im
dens = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for k, s in dens.items():
    p = f"{R}/mipmap-{k}"; os.makedirs(p, exist_ok=True)
    draw(s, s * 0.18).save(f"{p}/ic_launcher.png")
    draw(s, s * 0.2, round_=True).save(f"{p}/ic_launcher_round.png")
    fs = int(s * 108 / 48); draw(fs, fs * 0.3, bg=False).save(f"{p}/ic_launcher_foreground.png")
sp = Image.new("RGB", (1080, 1920), CREAM); h = draw(360, 40, bg=False); sp.paste(h, (360, 780), h)
for d in os.listdir(R):
    if d.startswith("drawable") and os.path.exists(f"{R}/{d}/splash.png"):
        sp.save(f"{R}/{d}/splash.png")
