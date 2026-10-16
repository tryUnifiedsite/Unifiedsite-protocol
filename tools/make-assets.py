"""Derives every raster and the favicon from the files in brand/.
Run once; outputs land in src/assets/. Not part of the deploy output."""
import numpy as np
from PIL import Image
from skimage import measure

B = "brand/"
TR = Image.open(B + "LOGO UNIFIED PNG...png").convert("RGBA")      # transparent, colour type 6
OP = Image.open(B + "LOGO UNIFIED PNG.png").convert("RGBA")        # opaque on ground
ground = OP.getpixel((0, 0))[:3]
a = np.array(TR)
al = a[..., 3]
ys, xs = np.where(al > 127)
x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
w, h = x1 - x0, y1 - y0
side = int(max(w, h) * 1.32)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
sq = TR.crop(box)

def pm_resize(img, size):
    # transparent regions are pure black, so resize in premultiplied space
    p = img.convert("RGBa").resize((size, size), Image.LANCZOS)
    return p.convert("RGBA")

for s in (768, 128):
    pm_resize(sq, s).save(f"src/assets/mark-{s}.png", optimize=True)

def on_ground(img, size, pad):
    base = Image.new("RGBA", (size, size), ground + (255,))
    m = pm_resize(img, size)
    base.alpha_composite(m)
    return base.convert("RGB")

on_ground(sq, 180, 0).save("src/assets/apple-touch-icon.png", optimize=True)

og = Image.new("RGBA", (1200, 630), ground + (255,))
m = pm_resize(sq, 520)
og.alpha_composite(m, (340, 55))
og.convert("RGB").save("src/assets/og.png", optimize=True)

# favicon: contour of the real alpha grid, fitted into a 32 grid
f = (al.astype(float) / 255.0)[y0 - 2:y1 + 2, x0 - 2:x1 + 2]
paths = []
scale = 21.0 / max(w, h)
ox = (32 - w * scale) / 2
oy = (32 - h * scale) / 2
for c in measure.find_contours(f, 0.5):
    c = measure.approximate_polygon(c, 2.2)
    pts = [(ox + (p[1] - 2) * scale, oy + (p[0] - 2) * scale) for p in c]
    d = "M" + " ".join(f"{x:.2f} {y:.2f}" for x, y in pts[:-1]) + "Z"
    paths.append(d)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
       '<rect width="32" height="32" rx="7" fill="{{ground}}"/>'
       '<path fill="{{ink}}" d="' + " ".join(paths) + '"/></svg>')
assert "--" not in svg
open("src/assets/favicon.tpl.svg", "w").write(svg)
print("ground", "#%02x%02x%02x" % ground, "bbox", x0, y0, x1, y1, "crop", box, "paths", len(paths), "svg bytes", len(svg))
