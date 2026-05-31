import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  countSpikesByChannel,
  detectThresholdCrossings,
  summarizeNoiseBand,
} from "../src/spike-detection.js";

describe("threshold crossing spike detection", () => {
  it("detects signed threshold crossings with a refractory gap", () => {
    const trace = new Float32Array([0, 2, 6, 7, 3, -6, -7, -1, 8]);
    const crossings = detectThresholdCrossings(trace, {
      absoluteChannel: 12,
      thresholdUv: 5,
      sampleRateHz: 1000,
      refractoryMs: 2,
    });

    assert.deepEqual(crossings, [
      {
        absoluteChannel: 12,
        sampleIndex: 2,
        timeMs: 2,
        amplitudeUv: 6,
        polarity: "positive",
      },
      {
        absoluteChannel: 12,
        sampleIndex: 5,
        timeMs: 5,
        amplitudeUv: -6,
        polarity: "negative",
      },
      {
        absoluteChannel: 12,
        sampleIndex: 8,
        timeMs: 8,
        amplitudeUv: 8,
        polarity: "positive",
      },
    ]);
  });

  it("counts crossings by absolute channel", () => {
    const counts = countSpikesByChannel([
      { absoluteChannel: 0 },
      { absoluteChannel: 0 },
      { absoluteChannel: 127 },
    ]);

    assert.equal(counts.length, 128);
    assert.equal(counts[0], 2);
    assert.equal(counts[127], 1);
    assert.equal(counts[64], 0);
  });

  it("summarizes a noise band from median absolute deviation", () => {
    const summary = summarizeNoiseBand(new Float32Array([-2, -1, 0, 1, 2, 20]));

    assert.equal(summary.centerUv, 0.5);
    assert.equal(summary.madUv, 1.5);
    assert.equal(summary.noiseFloorUv, 2.224);
  });
});
