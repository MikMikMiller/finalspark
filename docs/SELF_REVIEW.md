# Self-Review

Run date: 2026-05-31.

## Acceptance Checklist

- [x] Clean static run: `python3 -m http.server 4173`, opened `http://localhost:4173`.
- [x] No build step or framework.
- [x] Console health: Playwright desktop and mobile checks reported no console logs or page errors in the final pass.
- [x] Live source: page received live data from 4/4 MEAs; observed sample text `Live | 4/4 MEAs`.
- [x] Replay source: bundled real fixture loaded from `data/replay-sample.json`; observed `Replay | 4/4 MEAs`.
- [x] Replay without live websocket: browser test blocked `window.WebSocket`; replay still loaded and rendered from local fixture.
- [x] Demo source: synthetic in-browser source rendered 4/4 MEAs.
- [x] Overview: raster, firing-rate heatmap, activity timeline, Center of Activity, and signals-vs-noise canvases rendered non-empty.
- [x] Mapping: tests cover MEA boundaries and known index `absolute 37 = MEA 2, local 5, biochip 0, electrode 5`.
- [x] Explain layer: UI explains MEA, biochip, sample window, threshold crossings, Center of Activity, and signal/noise thresholding.
- [x] Honesty wording: grep found no banned overclaim terms and no invented biological labels in project text.
- [x] Preflight: grep found no local secrets, virtual-environment names, local absolute paths, temporary verify paths, viewport-scaled font sizes, negative letter spacing, blanket transitions, disabled zoom, or removed focus outlines.
- [x] README read against implementation and verification notes.

## Commands

```sh
npm test
rg preflight searches for overclaim wording, local absolute paths, env files, temporary verify paths, and UI anti-patterns
curl -I -s http://localhost:4173
```

Browser verification used Playwright against the local server at desktop `1440 x 1100` and mobile `390 x 900`.

## Final Browser Evidence

- Live: `Live | 4/4 MEAs`, crossings rendered.
- Replay: `Replay | 4/4 MEAs`, `3910` crossings in the captured fixture.
- Demo: `Demo | 4/4 MEAs`, synthetic crossings rendered.
- Mobile: `scrollWidth` equals viewport width and no overflowing elements were detected.
