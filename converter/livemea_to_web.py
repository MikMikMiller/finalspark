#!/usr/bin/env python3
"""Convert FinalSpark LiveMEA HDF5 recordings into frozen replay JSON."""

from __future__ import annotations

import argparse
import base64
import json
import math
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Sequence

import h5py
import numpy as np


ELECTRODE_COUNT = 32
MEAS_PER_PUBLIC_STREAM = 4
FRAME_SAMPLE_COUNT = 4096
SAMPLE_WINDOW_MS = 1092.3
DEFAULT_SAMPLE_RATE_HZ = FRAME_SAMPLE_COUNT / (SAMPLE_WINDOW_MS / 1000)
DEFAULT_SOURCE = "FinalSpark LiveMEA public activity stream (HDF5 recording)"
DEFAULT_TRANSPORT = "Recorded Socket.IO public activity stream via FinalSpark-np/LiveMEA"
DISCLAIMER = (
    "Public activity stream, not raw acquisition data. Threshold crossings are "
    "client-side activity markers, not cell identities. Electrode layout is "
    "logical by channel index, with no anatomy or region inference."
)


class ConversionError(Exception):
    """Raised when a LiveMEA HDF5 file cannot be converted."""


@dataclass(frozen=True)
class RecordingFrame:
    index: int
    timestamp: str
    samples: np.ndarray


def convert_livemea_h5_to_payload(
    input_path: str | Path,
    *,
    mea_id: int = 1,
    start_frame: int = 0,
    frame_count: int = 1,
    precision: int | None = None,
    sample_rate_hz: float = DEFAULT_SAMPLE_RATE_HZ,
) -> dict:
    """Return a dashboard-compatible frozen replay payload for one LiveMEA file."""
    input_path = Path(input_path)
    validate_options(
        input_path=input_path,
        mea_id=mea_id,
        start_frame=start_frame,
        frame_count=frame_count,
        precision=precision,
        sample_rate_hz=sample_rate_hz,
    )

    frames = read_livemea_frames(input_path)
    selected = select_frames(frames, start_frame=start_frame, frame_count=frame_count)
    samples = concatenate_channel_major(selected, precision=precision)
    samples_per_electrode = samples.size // ELECTRODE_COUNT
    sample_window_ms = (samples_per_electrode / sample_rate_hz) * 1000
    captured_at = normalize_timestamp(selected[0].timestamp)

    return {
        "schemaVersion": 1,
        "source": DEFAULT_SOURCE,
        "transport": DEFAULT_TRANSPORT,
        "capturedAt": captured_at,
        "sampleRateHz": sample_rate_hz,
        "sampleWindowMs": sample_window_ms,
        "encoding": (
            "base64 Float32Array little-endian, "
            f"{ELECTRODE_COUNT} electrodes x {samples_per_electrode} samples per MEA"
        ),
        "disclaimer": DISCLAIMER,
        "provenance": {
            "publicStreamOnly": True,
            "rawAcquisitionData": False,
            "neuroplatformAccess": False,
            "recorder": "FinalSpark-np/LiveMEA",
            "inputFile": input_path.name,
            "startFrame": start_frame,
            "frameCount": len(selected),
        },
        "samples": [
            build_sample_entry(
                samples=samples,
                mea_id=mea_id,
                captured_at=captured_at,
                samples_per_electrode=samples_per_electrode,
            )
        ],
    }


def read_livemea_frames(input_path: Path) -> list[RecordingFrame]:
    if not input_path.exists():
        raise ConversionError(f"Input file does not exist: {input_path}")
    if not input_path.is_file():
        raise ConversionError(f"Input path is not a file: {input_path}")

    try:
        with h5py.File(input_path, "r") as h5:
            keys = sorted(h5.keys(), key=timestamp_sort_key)
            frames = []
            for frame_index, key in enumerate(keys):
                group = h5[key]
                if not isinstance(group, h5py.Group):
                    continue
                frames.append(
                    RecordingFrame(
                        index=frame_index,
                        timestamp=str(key),
                        samples=read_electrode_group(group, group_name=str(key)),
                    )
                )
    except OSError as exc:
        raise ConversionError(f"Could not open HDF5 file: {exc}") from exc

    if not frames:
        raise ConversionError(
            "No timestamp groups found. Expected LiveMEA HDF5 groups containing electrode_0 through electrode_31."
        )
    return frames


def read_electrode_group(group: h5py.Group, *, group_name: str) -> np.ndarray:
    electrode_arrays = []
    expected_length = None
    for electrode_index in range(ELECTRODE_COUNT):
        dataset_name = f"electrode_{electrode_index}"
        if dataset_name not in group:
            raise ConversionError(f"Group {group_name!r} is missing dataset {dataset_name!r}.")

        dataset = group[dataset_name]
        if not isinstance(dataset, h5py.Dataset):
            raise ConversionError(f"Group {group_name!r} member {dataset_name!r} is not an HDF5 dataset.")

        values = np.asarray(dataset[...], dtype=np.float32)
        if values.ndim != 1:
            raise ConversionError(
                f"Dataset {group_name}/{dataset_name} must be one-dimensional, got shape {values.shape}."
            )
        if values.size == 0:
            raise ConversionError(f"Dataset {group_name}/{dataset_name} is empty.")
        if expected_length is None:
            expected_length = values.size
        elif values.size != expected_length:
            raise ConversionError(
                f"Dataset {group_name}/{dataset_name} has {values.size} samples; expected {expected_length}."
            )
        electrode_arrays.append(values.astype("<f4", copy=False))

    return np.stack(electrode_arrays)


def select_frames(
    frames: Sequence[RecordingFrame],
    *,
    start_frame: int,
    frame_count: int,
) -> Sequence[RecordingFrame]:
    end_frame = start_frame + frame_count
    selected = frames[start_frame:end_frame]
    if not selected:
        raise ConversionError(
            f"Frame range is empty. File has {len(frames)} frame(s), start_frame={start_frame}, frame_count={frame_count}."
        )
    if len(selected) < frame_count:
        raise ConversionError(
            f"Requested {frame_count} frame(s) from start_frame={start_frame}, but only {len(selected)} are available."
        )
    return selected


def concatenate_channel_major(
    frames: Sequence[RecordingFrame],
    *,
    precision: int | None,
) -> np.ndarray:
    channel_series = []
    for electrode_index in range(ELECTRODE_COUNT):
        channel_series.append(np.concatenate([frame.samples[electrode_index] for frame in frames]))
    samples = np.concatenate(channel_series).astype("<f4", copy=False)
    if precision is not None:
        samples = np.round(samples.astype(np.float64), precision).astype("<f4")
    return samples


def build_sample_entry(
    *,
    samples: np.ndarray,
    mea_id: int,
    captured_at: str,
    samples_per_electrode: int,
) -> dict:
    stats = compute_stats(samples)
    return {
        "meaId": mea_id,
        "sourceIndex": mea_id - 1,
        "capturedAt": captured_at,
        "bytes": int(samples.nbytes),
        "float32Length": int(samples.size),
        "electrodeCount": ELECTRODE_COUNT,
        "samplesPerElectrode": int(samples_per_electrode),
        "first8": round_list(samples[:8]),
        "min": stats["min"],
        "max": stats["max"],
        "mean": stats["mean"],
        "rms": stats["rms"],
        "base64Float32LE": base64.b64encode(samples.tobytes()).decode("ascii"),
    }


def compute_stats(samples: np.ndarray) -> dict:
    values = samples.astype(np.float64)
    return {
        "min": round_float(float(values.min())),
        "max": round_float(float(values.max())),
        "mean": round_float(float(values.mean())),
        "rms": round_float(float(math.sqrt(np.mean(values * values)))),
    }


def validate_options(
    *,
    input_path: Path,
    mea_id: int,
    start_frame: int,
    frame_count: int,
    precision: int | None,
    sample_rate_hz: float,
) -> None:
    if not str(input_path):
        raise ConversionError("Input path is required.")
    if not isinstance(mea_id, int) or mea_id < 1 or mea_id > MEAS_PER_PUBLIC_STREAM:
        raise ConversionError("MEA id must be an integer from 1 through 4.")
    if not isinstance(start_frame, int) or start_frame < 0:
        raise ConversionError("start_frame must be a non-negative integer.")
    if not isinstance(frame_count, int) or frame_count <= 0:
        raise ConversionError("frame_count must be a positive integer.")
    if precision is not None and (not isinstance(precision, int) or precision < 0):
        raise ConversionError("precision must be a non-negative integer.")
    if not math.isfinite(sample_rate_hz) or sample_rate_hz <= 0:
        raise ConversionError("sample_rate_hz must be a positive number.")


def timestamp_sort_key(value: str) -> tuple[int, str]:
    normalized = str(value).replace("Z", "+00:00")
    try:
        return (0, datetime.fromisoformat(normalized).isoformat())
    except ValueError:
        return (1, str(value))


def normalize_timestamp(value: str) -> str:
    normalized = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return str(value)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    return parsed.isoformat().replace("+00:00", "Z")


def round_float(value: float, digits: int = 3) -> float:
    return float(round(value, digits))


def round_list(values: Iterable[float], digits: int = 3) -> list[float]:
    return [round_float(float(value), digits) for value in values]


def write_payload(payload: dict, output_path: str | Path) -> None:
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a FinalSpark-np/LiveMEA HDF5 recording to web-ready frozen replay JSON."
    )
    parser.add_argument("input", type=Path, help="Input LiveMEA .h5 file.")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Output JSON file.")
    parser.add_argument(
        "--mea-id",
        type=int,
        default=1,
        help="Dashboard MEA slot for this one-MEA recording, from 1 through 4. Default: 1.",
    )
    parser.add_argument(
        "--start-frame",
        type=int,
        default=0,
        help="Zero-based timestamp group index to start from. Default: 0.",
    )
    parser.add_argument(
        "--frame-count",
        type=int,
        default=1,
        help="Number of recorded timestamp groups to concatenate. Default: 1.",
    )
    parser.add_argument(
        "--precision",
        type=int,
        default=None,
        help="Round microvolt samples to this many decimal places before Float32 encoding.",
    )
    parser.add_argument(
        "--sample-rate-hz",
        type=float,
        default=DEFAULT_SAMPLE_RATE_HZ,
        help=f"Sample rate to write into JSON metadata. Default: {DEFAULT_SAMPLE_RATE_HZ:.6f}.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        payload = convert_livemea_h5_to_payload(
            args.input,
            mea_id=args.mea_id,
            start_frame=args.start_frame,
            frame_count=args.frame_count,
            precision=args.precision,
            sample_rate_hz=args.sample_rate_hz,
        )
        write_payload(payload, args.output)
    except ConversionError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Error: could not write output: {exc}", file=sys.stderr)
        return 1

    sample = payload["samples"][0]
    print(
        "Wrote "
        f"{args.output} with MEA {sample['meaId']} "
        f"({sample['samplesPerElectrode']} samples/electrode)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
