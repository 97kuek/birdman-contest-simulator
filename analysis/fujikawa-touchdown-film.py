"""Measure image-space changes in the supplied 6th 8本目 cockpit recording.

Run with Python, numpy, Pillow and ffmpeg. Supply the original MP4 as the
first argument and optionally a path for a contact sheet as the second.
No video frames are kept unless the caller requests the sheet.
"""
import io
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

REFERENCE = 68.44  # onset of sustained rolling noise, not a visible wheel contact
TIMES = (0, 1, 2, 5)
# Horizontal sampling windows on the grass/pavement boundaries at 800 x 450.
WINDOWS = ((70, 565), (100, 535), (55, 595), (125, 610), (55, 530))


def frame(movie, seconds):
    raw = subprocess.check_output([
        "ffmpeg", "-loglevel", "error", "-ss", str(seconds), "-i", movie,
        "-an", "-vf", "scale=800:450", "-frames:v", "1", "-vcodec", "png",
        "-f", "image2pipe", "-",
    ])
    return Image.open(io.BytesIO(raw)).convert("RGB")


def edge(mask, start):
    points = []
    for x in range(start, start + 130):
        for y in range(252, 150, -1):
            if mask[y-2:y+1, x].all() and not mask[y+2:y+6, x].any():
                points.append((x, y))
                break
    points = np.array(points)
    for _ in range(3):
        slope, intercept = np.polyfit(*points.T, 1)
        points = points[abs(points[:, 1] - slope*points[:, 0] - intercept) < 3]
    return slope, points


def ridge_alignment(reference, current):
    # Translation and change of slope of the distant ridge. A trimmed fit
    # rejects the propeller and canopy ribs where they obscure the skyline.
    best = None
    for dx in range(-115, 46):
        xs = np.arange(37, 315)
        xi = xs + dx
        valid = (xi > 30) & (xi < 325) & np.isfinite(reference[xs]) & np.isfinite(current[xi])
        x = xs[valid] - 180
        dy = current[xi[valid]] - reference[xs[valid]]
        if len(x) < 100:
            continue
        keep = np.ones(len(x), dtype=bool)
        for _ in range(3):
            tilt, shift = np.polyfit(x[keep], dy[keep], 1)
            residual = abs(dy - tilt*x - shift)
            keep = residual <= max(2, np.percentile(residual, 72))
        result = (np.median(residual), dx, tilt)
        if best is None or result[0] < best[0]:
            best = result
    if best is None:
        raise ValueError("Distant ridge could not be matched")
    return best[1:]


def measure(img, reference):
    red, green, blue = np.asarray(img, dtype=float).transpose(2, 0, 1)
    grass = (green-blue > 15) & (red-blue > 10) & (green > red*.89)
    ridge = np.full(800, np.nan)
    for x in range(30, 325):
        mountains = np.flatnonzero((blue[104:205, x] < 170) & (red[104:205, x] < 115))
        if mountains.size:
            ridge[x] = 104 + mountains[0]
    dx, tilt = (0, 0) if reference is None else ridge_alignment(reference, ridge)
    # Position of the centre mast in the same rows in every frame.
    _, mast_x = np.nonzero(red[120:145, 370:435] < 55)
    mast = 370 + np.median(mast_x)
    fractions = []
    draw = ImageDraw.Draw(img)
    for index, (left, right) in enumerate(WINDOWS):
        slopes = []
        for start in (left, right):
            slope, points = edge(grass, start)
            slopes.append((slope - tilt) / (1 + slope * tilt))
            if index == 0:
                for x, y in points:
                    draw.line((x, y-1, x, y+1), fill="#ff5155")
        fractions.append(slopes[1] / (slopes[1] - slopes[0]))
    draw.line((mast, 120, mast, 144), fill="#37dcff", width=2)
    return ridge, dx, mast, np.array(fractions)


def main(movie, sheet=None):
    reference = None
    canvas = Image.new("RGB", (1200, 460), "#17232b")
    for i, seconds in enumerate(TIMES):
        img = frame(movie, REFERENCE + seconds)
        ridge, dx, mast, fractions = measure(img, reference)
        if reference is None:
            reference, initial_mast, initial_fractions = ridge, mast, fractions
        delta = fractions - initial_fractions
        bearing_px = mast - initial_mast - dx  # positive is a rightward turn
        print(f"t={seconds:+d} s  edge_index=[{delta.min():+.3f}, {delta.max():+.3f}]"
              f"  mast_minus_ridge={bearing_px:+.1f} px")
        x, y = i % 2 * 600, i // 2 * 230
        canvas.paste(img.crop((0, 88, 800, 358)).resize((600, 202)), (x, y+26))
        ImageDraw.Draw(canvas).text((x+12, y+5), f"{REFERENCE+seconds:.2f} s   T{seconds:+d} s", fill="white")
    if sheet:
        canvas.save(sheet)


if __name__ == "__main__":
    main(*sys.argv[1:])
