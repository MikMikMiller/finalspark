# LiveMEA HDF5 To Frozen Replay JSON

This utility converts a `FinalSpark-np/LiveMEA` recording (`.h5`) into the frozen replay JSON shape consumed by this repository's browser dashboard.

It is intentionally narrow: LiveMEA recording in, compact web-ready JSON out. It does not connect to the live Socket.IO service, Neuroplatform, or any hardware.

## Install

```sh
python3 -m pip install -r converter/requirements.txt
```

## Convert

```sh
python converter/livemea_to_web.py recording.h5 -o replay.json --mea-id 1
```

Then load `replay.json` with the existing frozen source:

```js
mount("#fsk", {
  source: "frozen",
  src: "replay.json"
});
```

## Options

- `--mea-id 1..4`: labels the one-MEA recording for the dashboard's logical MEA slot. The upstream HDF5 file stores local electrodes only, so this defaults to `1`.
- `--start-frame N`: zero-based timestamp group index to start from. Default: `0`.
- `--frame-count N`: number of timestamp groups to concatenate. Default: `1`.
- `--precision N`: optional microvolt rounding before Float32 encoding.
- `--sample-rate-hz N`: override the metadata sample rate. Default is the verified public-stream cadence, `4096 / 1.0923s`.

## Input

The converter expects the HDF5 structure written by `FinalSpark-np/LiveMEA`:

```text
<timestamp group>/
  electrode_0   # 1D samples for local electrode 0
  electrode_1
  ...
  electrode_31
```

Each timestamp group is one recorded public-stream frame. The recorder subscribes to one MEA at a time and writes `32 x 4096` voltage samples per frame.

## Output

The output mirrors `data/replay-sample.json`:

- top-level stream metadata (`schemaVersion`, `source`, `transport`, `capturedAt`, `sampleRateHz`, `sampleWindowMs`, `encoding`)
- a `samples` array with one entry for the selected `meaId`
- `base64Float32LE`, encoded as little-endian `Float32Array` data in channel-major order: electrode 0 samples, then electrode 1, through electrode 31

Extra provenance fields are safe for the existing frozen-source loader; it ignores fields it does not need.

## Boundaries

- Public activity stream, not raw acquisition data.
- The public stream is a compressed activity stream, not a Neuroplatform raw-acquisition export.
- Threshold crossings are computed in the browser and are activity markers, not cell identities.
- The electrode layout is logical by channel index; no anatomy or biological region is inferred.
- The converter performs no live socket access, network access, Neuroplatform access, sorting, or visualization.

The verified public stream details are documented in `docs/VERIFY.md`.

## Test

```sh
python -m unittest discover -s converter/tests -v
```
