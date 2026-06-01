import { REPLAY_FIXTURE_URL } from "../config.js?v=20260601-perf";
import { cloneMeaSample, makeFrame } from "./frame-utils.js?v=20260601-perf";
import { normalizeReplayPayload } from "./replay-codec.js?v=20260601-perf";

export class ReplaySource {
  constructor({ fixtureUrl = REPLAY_FIXTURE_URL } = {}) {
    this.fixtureUrl = fixtureUrl;
    this.timer = null;
    this.payload = null;
  }

  async start(onFrame, onStatus) {
    this.stop();
    onStatus?.({ level: "info", message: "Loading bundled replay fixture." });

    const response = await fetch(this.fixtureUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Replay fixture failed to load: ${response.status}`);
    }

    this.payload = normalizeReplayPayload(await response.json());
    let tick = 0;
    const emit = () => {
      const timestamp = new Date(Date.now() + tick * this.payload.sampleWindowMs);
      tick += 1;
      onFrame(
        makeFrame({
          source: "replay",
          timestamp,
          sampleRateHz: this.payload.sampleRateHz,
          sampleWindowMs: this.payload.sampleWindowMs,
          meas: this.payload.meas.map(cloneMeaSample),
        }),
      );
    };

    emit();
    this.timer = setInterval(emit, this.payload.sampleWindowMs);
    onStatus?.({ level: "ok", message: "Replay fixture is running locally." });
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
