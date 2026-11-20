"""Estimate changes in apparent wing bank in Windnauts' July 2, 2023 rear view.

Usage: uv run --with numpy --with opencv-python-headless analysis/ren-kakuda-roll.py VIDEO
For a clip, pass its start time on the original timeline with --clip-start.
Requires ffmpeg. Results are relative to the first frame, positive right down.
"""
import argparse
import csv
import math
import subprocess
import sys

import cv2
import numpy as np


# Seconds 168 through 178 inclusive. Manually located wing roots in a 480x270
# preview; sampling below uses twice this resolution.
ROOTS = [(212, 147), (216, 154), (221, 163), (230, 175), (242, 185), (251, 181),
         (202, 170), (222, 168), (245, 161), (264, 152), (276, 148)]


def frame_at(path, seconds):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(seconds), '-i', path,
                                   '-frames:v', '1', '-vf', 'scale=960:540', '-f', 'image2pipe',
                                   '-c:v', 'png', 'pipe:1'])
    return cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_GRAYSCALE)


def mountain_features(gray, cy, sift):
    mask = np.zeros_like(gray)
    mask[:2 * (cy - 68)] = 255
    return sift.detectAndCompute(gray, mask)


def camera_roll(reference, current):
    a, descriptors_a = reference
    b, descriptors_b = current
    pairs = cv2.BFMatcher().knnMatch(descriptors_a, descriptors_b, k=2)
    matches = [p for p, q in pairs if p.distance < 0.72 * q.distance]
    src = np.float32([a[m.queryIdx].pt for m in matches])
    dst = np.float32([b[m.trainIdx].pt for m in matches])
    affine, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC,
                                                   ransacReprojThreshold=1.6)
    if affine is None or inliers.sum() < 10:
        raise ValueError('Too few matching background features')
    return math.degrees(math.atan2(affine[1, 0], affine[0, 0])), int(inliers.sum())


def wing_angle(response, cx, cy, lower, upper):
    # Compare equally spaced port/starboard points to cancel symmetric bend.
    lo, hi = 2 * (cy - 36), 2 * (cy + 4)
    angles = []
    for dist in range(lower, upper, 2):
        heights = []
        for x in [2 * (cx - dist), 2 * (cx + dist)]:
            signal = response[lo:hi, x-1:x+2].mean(axis=1)
            peak = int(np.argmax(signal))
            band = np.arange(max(peak - 4, 0), min(peak + 5, hi - lo))
            heights.append(np.average(band, weights=0.01 + signal[band]))
        angles.append(math.degrees(math.atan2(heights[1] - heights[0], 4 * dist)))
    return np.median(angles)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('video')
    parser.add_argument('--clip-start', type=float, default=0)
    args = parser.parse_args()
    sift = cv2.SIFT_create(contrastThreshold=0.008)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 19))
    writer = csv.writer(sys.stdout)
    writer.writerow(['seconds', 'wing_image_deg', 'camera_change_deg', 'wing_change_deg',
                     'sensitivity_min_deg', 'sensitivity_max_deg', 'background_inliers'])
    for t, (cx, cy) in enumerate(ROOTS, start=168):
        gray = frame_at(args.video, t - args.clip_start)
        features = mountain_features(gray, cy, sift)
        response = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
        # Vary both the centre and the portion of the span used for measurement.
        angles = np.array([wing_angle(response, cx + dx, cy, low, low + 24)
                           for dx in (-3, 0, 3) for low in (78, 105, 136)])
        angle = wing_angle(response, cx, cy, 90, 140)
        if t == 168:
            reference, initial_angle, initial_angles = features, angle, angles
        roll, count = camera_roll(reference, features)
        relative = angles - initial_angles - roll
        writer.writerow([t, round(angle, 3), round(roll, 3), round(angle - initial_angle - roll, 3),
                         round(relative.min(), 3), round(relative.max(), 3), count])


if __name__ == '__main__':
    main()
