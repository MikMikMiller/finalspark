# Verification Notes

This verification was completed before writing application code.

## Source Repositories

Temporary clones were read outside this repo and were not copied into this repo.

| Source | Observed facts |
| --- | --- |
| `FinalSpark-np/LiveMEA` | `livemea/MEA_live.py` uses `https://livemeaservice.finalspark.com`, emits `meaid`, reads `data["buffer"]` with `np.frombuffer(..., dtype=np.float32)`, reshapes to `32 x 4096`, and writes HDF5 datasets per electrode. |
| `maidenlabs/finalspark-ts` | `src/index.ts` uses `https://livemeaservice2.alpvision.com`, emits `meaid`, converts `data.buffer` to `Float32Array`, and slices a selected `32 x 4096` MEA window. |
| `FinalSpark-np/LiveMEA_ts` | The FinalSpark fork matches the maidenlabs TypeScript access layer. |
| `maidenlabs/finalspark-rs` | Uses raw `wss://livemeaservice2.alpvision.com/socket.io/?EIO=4&transport=websocket`, sends `42["meaid", index]`, decodes `f32`, and accepts `32 x 4096` or `128 x 4096` payloads. |

Key source pointers from the verification pass:

- `LiveMEA/livemea/MEA_live.py:11`: official service URL.
- `LiveMEA/livemea/MEA_live.py:121`: binary buffer decoded as `float32`.
- `LiveMEA/livemea/MEA_live.py:166`: per-electrode HDF5 dataset write.
- `finalspark-ts/src/index.ts:14`: fallback service URL.
- `finalspark-ts/src/index.ts:45`: `recordSample(meaId)`.
- `finalspark-ts/src/index.ts:60`: `Float32Array(data.buffer)`.
- `finalspark-ts/src/index.ts:64`: selected MEA offset math.
- `finalspark-rs/src/lib.rs:34`: raw websocket URL.
- `finalspark-rs/src/lib.rs:167`: zero-based `meaid` event packet.
- `finalspark-rs/src/lib.rs:189`: `32 * 4096` payload branch.

## Live Browser Observation

`https://finalspark.com/live/` embeds `https://livemea.finalspark.com/liveview`. The browser app bundle points at `https://livemeaservice.finalspark.com`, checks `/check`, `/islive`, `/defaultmea`, and `/layoutmea/:id`, and subscribes to `livedata`.

Observed live API responses:

- `/check`: `OK`
- `/islive`: `{"status":true}`
- `/defaultmea`: `{"index":0}`
- `/layoutmea/0`, `/layoutmea/1`, `/layoutmea/2`, `/layoutmea/3`: `{"type":1}`

Observed websocket sequence against the public service:

1. Open `wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket`.
2. Receive Engine.IO open packet `0{...}`.
3. Send `40`.
4. Receive Socket.IO namespace connect packet `40{...}`.
5. Send `42["meaid",0]` for MEA 1.
6. Receive text placeholder `451-["livedata",{"buffer":{"_placeholder":true,"num":0}}]`.
7. Receive one binary frame.

Six MEA 1 binary frames were observed. Each frame was `524288` bytes, exactly `32 * 4096 * 4`. Intervals after the first frame were `561`, `1215`, `1109`, `1292`, and `1215` ms. The stream is push-based after the selection event; the dashboard does not poll.

For a 4-MEA overview, the app opens four selected-MEA sockets with reconnect backoff and tears them down on source changes. This mirrors the one-MEA selection protocol without adding a request loop.

## Data Units And Cadence

The official UI exposes trace ranges `+/-50`, `+/-100`, `+/-200`, `+/-500`, `+/-1000`, and `+/-2000 uV`. Live float values were in the same microvolt-scale range. The app treats incoming samples as raw voltage and performs threshold crossing detection client-side.

The verified sample window is `4096` samples over `1092.3 ms`, or about `3749.9 Hz`.

## Frozen Fixture

`data/replay-sample.json` contains one real frame per MEA captured from the public service on `2026-05-31T20:21:13.222Z`.

| MEA | Bytes | Float32 values | Min uV | Max uV | RMS uV |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 524288 | 131072 | -35.437 | 33.989 | 6.507 |
| 2 | 524288 | 131072 | -73.079 | 63.427 | 8.744 |
| 3 | 524288 | 131072 | -1547.217 | 1062.203 | 85.151 |
| 4 | 524288 | 131072 | -124.580 | 118.237 | 18.055 |

The frozen file stores each MEA as base64 little-endian `Float32Array` data. It is loaded locally by `FrozenSource`, so frozen mode works without contacting the live service.

## Center Of Activity

The Center of Activity view uses the weighted average electrode position described in the Frontiers paper DOI `10.3389/frai.2024.1376042`: each electrode contributes its logical `x, y` coordinate weighted by its threshold crossing count. The result is a statistical position on the electrode grid, not a biological area label.

## Politeness And Scope

The public live page and LiveMEA access code are open without authentication. The implementation still keeps the scope narrow:

- No credentialed Neuroplatform APIs.
- No scanning or discovery of private infrastructure.
- No polling loop after subscription.
- Reconnect backoff up to 30 seconds.
- Websockets are closed when leaving live mode.
