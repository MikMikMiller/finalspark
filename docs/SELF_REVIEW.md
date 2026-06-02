# Self-Review

Run date: 2026-06-02.

## Acceptance Checklist

- [x] Verified current repo clone against `origin/main` before edits; `HEAD` and `origin/main` were both `877e72dfb528c518c264fc7b2b8591e80905910e`.
- [x] Read `src/` and `docs/VERIFY.md` before implementation.
- [x] Current pre-refactor source-to-render contract was identified as `{ source, timestamp, sampleRateHz, sampleWindowMs, meas: [{ meaId, data: Float32Array(32 * 4096) }] }`.
- [x] Final adapter contract is normalized to `{ tStart, tEnd, channelCount, sampleCount, sampleRateHz, units, samples, availableChannels }`.
- [x] `src/kernel/time-series-core.js` contains no FinalSpark, Socket.IO, MEA, or `meaid` terms.
- [x] Live, frozen, and demo sources expose `meta()`, `start(onFrame, onStatus)`, and `stop()`. Frozen also exposes `seek(t)`.
- [x] Frozen source loads `data/replay-sample.json` through the same normalized frame path.
- [x] `fs-kernel.mjs` exports `mount()` and defines `<fs-kernel>`.
- [x] Embed example works with one import and frozen source from a static host.
- [x] Shadow DOM isolates the kernel stylesheet from the host page.
- [x] URL state restores `source`, `view`, `window`, `threshold`, `range`, `labels`, and frozen `position`.
- [x] Honesty wording uses threshold crossings/activity, not sorted units or sorting claims.
- [x] README documents embeddability, source-adapter contract, and LSL via bridge as roadmap only.

## Section 5 Verification Log

Confirmed against `docs/VERIFY.md` and the current live adapter code:

- Transport remains Socket.IO over Engine.IO 4 websocket, not raw browser polling.
- Primary endpoint is `wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket`.
- Fallback endpoint is `wss://livemeaservice2.alpvision.com/socket.io/?EIO=4&transport=websocket`.
- MEA selection is still `42["meaid", index]` with zero-based index.
- Live binary payload validation remains `32 * 4096 * 4` bytes per MEA.
- Units remain raw microvolt-scale voltage; threshold crossings are detected client-side.
- Cadence remains the verified `4096` samples over about `1092.3 ms`, roughly `3.75 kHz`.

No divergence was found between section 5 of the spec, `docs/VERIFY.md`, and the current live adapter logic.

## Commands

```sh
npm test
python3 -m http.server 4173
NODE_PATH=<bundled-node-modules> node <browser verification script>
rg preflight searches for stale replay adapter imports, local absolute paths, env files, and overclaim terminology
```

Browser verification used Playwright from the bundled Codex runtime against the local static server.

## Browser Evidence

- Standalone custom element at `/?source=frozen&view=overview&window=12`: observed `Frozen | 128/128 channels`.
- Raster canvas rendered nonblank: `1354 x 460`, `622840` nonblank pixels.
- View URL state updated to `view=mapping`; overview raster hid and mapping heatmap stayed visible.
- `embed-example.html`: `mount("#fsk", { source: "frozen", src: "data/replay-sample.json" })` rendered `Frozen | 128/128 channels`.
- Mobile `390 x 900`: document `scrollWidth` matched viewport width and kernel root had no horizontal overflow.

## NWB Excerpt Adapter Review

Run date: 2026-06-02.

- [x] `src/kernel/time-series-core.js` stayed unchanged and contains no FinalSpark, Socket.IO, MEA-id, `livedata`, or NWB terms.
- [x] `NwbSource` implements the same source adapter surface as live/frozen/demo: `meta()`, `start(onFrame, onStatus)`, `stop()`, and recorded-source `seek(t)`.
- [x] NWB parsing lives in `src/data/nwb-codec.js` and `src/data/nwb-source.js`; h5wasm is imported lazily only when `source: "nwb"` is selected.
- [x] `mount("#fsk", { source: "nwb", src: "data/nwb-excerpt.nwb" })` uses the existing public mount contract.
- [x] Superseded local-fixture note: the first bundled fixture was replaced by the synthetic multichannel file described below.
- [x] README describes NWB as read-only excerpt playback and keeps LSL, DANDI browsing/search, and NWB writing as not included.
- [x] Superseded first-fixture run: `npm test` passed with `28` tests.
- [x] Superseded first-fixture h5wasm readback is no longer the current fixture proof; the current bundled fixture is the synthetic 24-channel file described below.
- [x] Browser verification passed for `source=nwb` at 390 px mobile width with `docWidth: 390`, `rootOverflow: 0`, and `bodyOverflow: 0`.
- [x] `embed-example-nwb.html` loaded NWB in one mount point and switched the same mount point back to frozen JSON.

Fork B verdict: passed. Core and adapter contract were not changed; NWB was added as a second recorded-source adapter behind the existing source interface.

## NWB Multichannel Demo Fixture Review

Run date: 2026-06-02.

- [x] `src/kernel/time-series-core.js` stayed unchanged.
- [x] `src/data/nwb-source.js` behavior stayed unchanged; the multichannel fixture is read through the existing local `NwbSource`.
- [x] `src/data/nwb-codec.js` still reads the generated PyNWB TimeSeries and now also supports bounded `Dataset.slice()` reads for remote excerpts.
- [x] `data/nwb-excerpt.nwb` is now a synthetic 24-channel, 6-second, 1000 Hz TimeSeries with `unit: microvolts`.
- [x] `tools/make-nwb-fixture.py` regenerates the fixture with PyNWB and labels it as synthetic, not biological.
- [x] h5wasm readback returned `sourceKind: "nwb"`, `channelCount: 24`, `sampleRateHz: 1000`, `frames: 2`, and `seriesPath: acquisition/synthetic_multichannel_microvolts`.
- [x] Early single-series DANDI range/CORS exploration was superseded by the current remote multichannel proof recorded in the next section.
- [x] Remote DANDI playback is implemented as separate `source: "nwb-url"`; local `source: "nwb"` remains the full-buffer path for bundled excerpts and browser files.

Milestone 3 fixture verdict: local adapter behavior stayed intact; remote URL support lives in a separate source adapter.

## Remote NWB URL Adapter Review

Run date: 2026-06-02.

- [x] `src/kernel/time-series-core.js` stayed unchanged and contains no NWB, DANDI, h5wasm, FinalSpark, Socket.IO, or MEA terms.
- [x] `source: "nwb-url"` is isolated in `src/data/nwb-url-source.js` and `src/data/nwb-url-worker.js`.
- [x] DANDI API asset download URLs are resolved to the bare object-store `contentUrl` before h5wasm lazy-file open, because the signed API redirect does not work for h5wasm `HEAD`.
- [x] Browser worker proof loaded DANDI asset `11646673-ac9a-42a0-b768-470af79ff4bc` from dandiset `000021` and rendered `NWB URL`, `96/96 channels`, `sampleRate: 1250.0 Hz`, with status `Remote NWB source is running from byte ranges.`
- [x] The selected real-file series was `acquisition/probe_729445654_lfp/probe_729445654_lfp_data`, an `ElectricalSeries` with shape `[12081218, 96]`; the reader derives the sample rate from regular `timestamps` when `starting_time.rate` is absent.
- [x] The same S3 object returned `206 Partial Content`, `Accept-Ranges: bytes`, and `Content-Range: bytes 0-1023/71781159` for a range probe.
- [x] h5wasm `FS.createLazyFile()` needed a worker-local `Accept-Ranges: bytes` header shim because S3 CORS does not expose that header, even though a prior `Range` probe returns `206 Partial Content`.
- [x] `npm test` passed with `37` tests.
