# FinalSpark Live Activity Dashboard

Zero-build browser dashboard for the public FinalSpark LiveMEA stream. It complements the official raw trace view with a compact overview: threshold crossings, firing-rate heatmaps, activity timeline, Center of Activity, and an explanation layer for reading the stream.

This project is public-stream-only. It does not use Neuroplatform credentials, booked hardware access, private datasets, or platform APIs.

## Run Locally

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

No install step is required for the app. Tests use the built-in Node.js test runner:

```sh
npm test
```

## Data Sources

- `Live`: four polite Socket.IO websocket connections to the public LiveMEA service, one selected MEA per socket. Each connection has reconnect backoff and is closed when the source changes.
- `Replay`: `data/replay-sample.json`, a bundled real capture from the public stream. This mode keeps the dashboard inspectable when the upstream stream is unavailable.
- `Demo`: deterministic synthetic voltage traces generated in the browser.

## What The Dashboard Shows

- `Live Raster`: 128 channels across 4 MEAs. Marks are simple voltage threshold crossings.
- `Firing-Rate Heatmap`: logical electrode layout by index, grouped as 4 MEAs x 32 electrodes.
- `Activity Timeline`: population threshold crossings over recent frames.
- `Center of Activity`: weighted average electrode position from crossing counts, following the formula described in the Frontiers paper DOI `10.3389/frai.2024.1376042`.
- `Signals vs Noise`: a probe trace with the current threshold band.

Threshold crossings are coarse activity markers. They are not assigned cell identities. The electrode grid is a logical layout by index; no biological area is inferred.

## Verified Data Contract

Verification was done before writing app code. Details are in `docs/VERIFY.md`.

- Public page: `https://finalspark.com/live/`
- Browser app iframe: `https://livemea.finalspark.com/liveview`
- Primary websocket: `wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket`
- Fallback websocket: `wss://livemeaservice2.alpvision.com/socket.io/?EIO=4&transport=websocket`
- Protocol: Engine.IO 4 plus Socket.IO event framing.
- Selection: after namespace connect, send `42["meaid", index]` where `index` is zero-based.
- Delivery: the server pushes a `livedata` placeholder text packet followed by one binary frame.
- Frame shape: `32 * 4096` little-endian `float32` values per MEA, `524288` bytes.
- Units: raw voltage in microvolt-scale values, matching the official `+/-50` to `+/-2000 uV` range control.
- Cadence: approximately one `4096` sample window per `1092.3 ms`, about `3.75 kHz`.

## Project Shape

The app is plain static HTML, CSS, and ES modules:

- `src/data/*`: live, replay, demo, and Socket.IO packet helpers.
- `src/mapping.js`: absolute/local channel mapping and logical layout.
- `src/spike-detection.js`: threshold crossing detection.
- `src/metrics.js`: rates, population activity, and Center of Activity.
- `src/render/*`: canvas renderers for raster, heatmap, timeline, CoA, and trace explanation.

The app should run from any simple static host, including GitHub Pages.

