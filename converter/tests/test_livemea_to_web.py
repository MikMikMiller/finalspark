import base64
import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import h5py
import numpy as np

from converter.livemea_to_web import ConversionError, convert_livemea_h5_to_payload


SAMPLES_PER_FRAME = 4096
SAMPLE_RATE_HZ = 4096 / (1092.3 / 1000)


class LiveMeaToWebTests(unittest.TestCase):
    def test_converts_selected_frame_range_into_frozen_payload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / "recording.h5"
            write_livemea_h5(source_path, frame_count=3)

            payload = convert_livemea_h5_to_payload(
                source_path,
                mea_id=2,
                start_frame=1,
                frame_count=2,
                precision=3,
            )

        self.assertEqual(payload["schemaVersion"], 1)
        self.assertEqual(payload["sampleRateHz"], SAMPLE_RATE_HZ)
        self.assertEqual(payload["sampleWindowMs"], (SAMPLES_PER_FRAME * 2 / SAMPLE_RATE_HZ) * 1000)
        self.assertEqual(payload["encoding"], "base64 Float32Array little-endian, 32 electrodes x 8192 samples per MEA")
        self.assertIn("Public activity stream, not raw acquisition data.", payload["disclaimer"])
        self.assertEqual(len(payload["samples"]), 1)

        sample = payload["samples"][0]
        self.assertEqual(sample["meaId"], 2)
        self.assertEqual(sample["sourceIndex"], 1)
        self.assertEqual(sample["electrodeCount"], 32)
        self.assertEqual(sample["samplesPerElectrode"], SAMPLES_PER_FRAME * 2)
        self.assertEqual(sample["float32Length"], 32 * SAMPLES_PER_FRAME * 2)
        self.assertEqual(sample["bytes"], 32 * SAMPLES_PER_FRAME * 2 * 4)
        self.assertEqual(sample["first8"], [100000.0, 100001.0, 100002.0, 100003.0, 100004.0, 100005.0, 100006.0, 100007.0])

        decoded = np.frombuffer(base64.b64decode(sample["base64Float32LE"]), dtype="<f4")
        self.assertEqual(decoded.size, 32 * SAMPLES_PER_FRAME * 2)
        self.assertEqual(decoded[0], 100000.0)
        self.assertEqual(decoded[SAMPLES_PER_FRAME], 200000.0)
        self.assertEqual(decoded[2 * SAMPLES_PER_FRAME], 101000.0)
        self.assertEqual(sample["min"], 100000.0)
        self.assertEqual(sample["max"], 235095.0)
        self.assertTrue(math.isclose(sample["mean"], float(decoded.mean()), rel_tol=0, abs_tol=0.001))
        self.assertTrue(math.isclose(sample["rms"], float(np.sqrt(np.mean(decoded.astype(np.float64) ** 2))), rel_tol=0, abs_tol=0.001))

    def test_cli_writes_json_output(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / "recording.h5"
            output_path = Path(tmpdir) / "out.json"
            write_livemea_h5(source_path, frame_count=1)

            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "converter.livemea_to_web",
                    str(source_path),
                    "-o",
                    str(output_path),
                    "--mea-id",
                    "4",
                ],
                cwd=Path(__file__).resolve().parents[2],
                check=False,
                capture_output=True,
                text=True,
            )

            self.assertEqual(completed.returncode, 0, completed.stderr)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["samples"][0]["meaId"], 4)
            self.assertIn("Wrote", completed.stdout)
            self.assertEqual(completed.stderr, "")

    def test_malformed_h5_reports_missing_electrode_dataset(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / "broken.h5"
            with h5py.File(source_path, "w") as h5:
                group = h5.create_group("2026-05-31 20:21:01.000000+00:00")
                group.create_dataset("electrode_0", data=np.zeros(SAMPLES_PER_FRAME, dtype=np.float32))

            with self.assertRaisesRegex(ConversionError, "electrode_1"):
                convert_livemea_h5_to_payload(source_path)


def write_livemea_h5(path, frame_count):
    with h5py.File(path, "w") as h5:
        for frame_index in range(frame_count):
            group = h5.create_group(f"2026-05-31 20:21:0{frame_index + 1}.000000+00:00")
            for electrode_index in range(32):
                offset = frame_index * 100000 + electrode_index * 1000
                group.create_dataset(
                    f"electrode_{electrode_index}",
                    data=np.arange(SAMPLES_PER_FRAME, dtype=np.float32) + offset,
                )


if __name__ == "__main__":
    unittest.main()
