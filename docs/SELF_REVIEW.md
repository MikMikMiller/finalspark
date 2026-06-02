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
