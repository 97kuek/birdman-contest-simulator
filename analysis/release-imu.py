"""Estimate Tatsumi's release attitude and rate from the two competition IMUs."""

import argparse
import csv
import hashlib
import io
import math
from pathlib import Path
from statistics import mean, median


def read_csv(path, expected_blob):
    raw = path.read_bytes()
    header = f"blob {len(raw)}\0".encode()
    if hashlib.sha1(header + raw).hexdigest() != expected_blob:
        raise ValueError(f"{path}: expected Git blob {expected_blob}")
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), skipinitialspace=True)
    return list(reader)


def line_at(rows, column, sign, time):
    # Centering avoids a dependence on the choice of log time origin.
    times = [float(r["FlightTime"]) for r in rows]
    values = [sign * float(r[column]) for r in rows]
    t_mean, value_mean = mean(times), mean(values)
    slope = sum((t - t_mean) * (v - value_mean) for t, v in zip(times, values))
    slope /= sum((t - t_mean) ** 2 for t in times)
    return value_mean + slope * (time - t_mean), slope


def window(rows, start, end):
    return [r for r in rows if start <= float(r["FlightTime"]) <= end]


def print_fit(rows, center, start, end):
    sample = window(rows, start, end)
    main = line_at(sample, "bno_pitch", -1, center)
    air = line_at(sample, "data_air_bno_pitch", 1, center)
    print(f"{center:5.2f} {start:5.2f} {end:5.2f} {len(sample):2d} "
          f"{main[0]:7.2f} {main[1]:7.2f} {air[0]:7.2f} {air[1]:7.2f}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("raw_csv", type=Path, help="getWindVector/src/2025FlightLog.csv")
    parser.add_argument("team_csv", type=Path, help="flightDataPlot/src/2025_Tatsumi.csv")
    args = parser.parse_args()
    raw = read_csv(args.raw_csv, "9cce461e0fc803541f131cd6177a8c110967fc6e")
    team = read_csv(args.team_csv, "24ce501f21a25c5ef42e5b71acae320862691096")
    if len(raw) != len(team) or any(
        float(r["FlightTime"]) != float(s["Time"]) or float(r["bno_pitch"]) != float(s["Pitch"])
        for r, s in zip(raw, team)
    ):
        raise ValueError("Time and main pitch differ between the two files")
    print(f"Both files have {len(raw)} identical time/main pitch pairs.")

    print("\n center start   end  n  main θ  main θ̇   air θ   air θ̇ (s, °, °/s)")
    for center in (3.7, 3.8, 3.9, 4.0, 4.1, 4.15, 4.4, 4.65, 4.9, 5.15):
        print_fit(raw, center, center - 0.2, center + 0.2)
    print("At release + 0.75 s, both IMUs across candidate log origins")
    for origin in (3.70, 3.90, 3.95, 3.98, 4.00, 4.10):
        center = origin + 0.75
        print_fit(raw, center, center - 0.20, center + 0.20)
    print("Window sensitivity at t = 3.90")
    for half_width in (0.15, 0.25, 0.30):
        print_fit(raw, 3.9, 3.9 - half_width, 3.9 + half_width)
    print("One-sided fits at t = 3.90")
    print_fit(raw, 3.9, 3.65, 3.9)
    print_fit(raw, 3.9, 3.9, 4.15)

    records = window(raw, 3.9, 13.9)
    times = [float(r["FlightTime"]) for r in records]
    dt = median(b - a for a, b in zip(times, times[1:]))
    main_pitch = [-float(r["bno_pitch"]) for r in records]
    air_pitch = [float(r["data_air_bno_pitch"]) for r in records]
    offset = median(a - m for a, m in zip(air_pitch, main_pitch))
    print(f"\nFirst 10 s: n = {len(times)}, median dt = {dt:.3f} s, "
          f"median air − main = {offset:.2f}°")
    print("air row shift, offset-corrected RMS difference (°)")
    for shift in range(-2, 3):
        # Hold the main samples fixed, including identical endpoints for all shifts.
        diffs = [air_pitch[i + shift] - main_pitch[i] for i in range(2, len(records) - 2)]
        bias = median(diffs)
        rms = math.sqrt(mean((d - bias) ** 2 for d in diffs))
        print(f"{shift:+d} {rms:.3f}")
    nadir = max(window(raw, 3.9, 5.9), key=lambda r: float(r["bno_pitch"]))
    print(f"First 2 s: deepest raw main pitch = {-float(nadir['bno_pitch']):.2f}°, "
          f"time after release = {float(nadir['FlightTime']) - 3.9:.3f} s")
    median_series = []
    for step in range(9):
        center = 3.9 + step * 0.25
        sample = window(raw, center - 0.25, center + 0.25)
        median_series.append(median(-float(r["bno_pitch"]) for r in sample))
    print(f"First 2 s: deepest 0.25 s grid median = {min(median_series):.2f}°, "
          f"time after release = {median_series.index(min(median_series)) * 0.25:.2f} s")
    print("\nLog time (s), underbody ultrasonic (m), onboard lake altitude (m)")
    for row in window(raw, 3.69, 4.1):
        print(row["FlightTime"], row["data_under_urm_altitude_m"], row["estimated_altitude_lake_m"])

    altitude_columns = ("true_alt", "data_main_dps_altitude_m", "data_under_dps_altitude_m",
                        "air_dps_altitude_m", "estimated_altitude_lake_m")
    if any(float(r["true_alt"]) != float(s["Altitude"]) for r, s in zip(raw, team)
           if 3.4 <= float(r["FlightTime"]) <= 4.4):
        raise ValueError("Corrected altitude differs between the two files around release")
    print("\nHalf window (s), n, altitude slopes (m/s): corrected, main, under, air, onboard")
    for half_width in (0.20, 0.35, 0.50):
        rows = window(raw, 3.9 - half_width, 3.9 + half_width)
        slopes = [line_at(rows, column, 1, 3.9)[1] for column in altitude_columns]
        print(f"{half_width:.2f} {len(rows):2d}", *(f"{value:+.3f}" for value in slopes))


if __name__ == "__main__":
    main()
