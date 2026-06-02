import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeNwbTimeSeries,
  toChannelMajorSamples,
} from "../src/data/nwb-codec.js";

describe("NWB source codec", () => {
  it("normalizes a one-dimensional NWB TimeSeries into generic source frames", () => {
    const normalized = normalizeNwbTimeSeries({
      path: "acquisition/data_00000_AD0",
      neurodataType: "VoltageClampSeries",
      data: new Float32Array([2.5, 0, -1.875, -2.5, -0.625, 0]),
      shape: [6],
      sampleRateHz: 200000,
      startingTimeSeconds: 294.2589998245239,
      units: "amperes",
      frameSampleCount: 3,
      sourceProvenance: {
        source: "dandi:000020",
      },
    });

    assert.equal(normalized.meta.sourceKind, "nwb");
    assert.equal(normalized.meta.channelCount, 1);
    assert.equal(normalized.meta.sampleCount, 3);
    assert.equal(normalized.meta.sampleRateHz, 200000);
    assert.equal(normalized.meta.units, "amperes");
    assert.equal(normalized.meta.sourceProvenance.format, "NWB");
    assert.equal(normalized.meta.sourceProvenance.seriesPath, "acquisition/data_00000_AD0");
    assert.equal(normalized.meta.sourceProvenance.neurodataType, "VoltageClampSeries");
    assert.equal(normalized.meta.sourceProvenance.recordingStartSeconds, 294.2589998245239);
    assert.equal(normalized.frames.length, 2);
    assert.equal(normalized.frames[0].sourceKind, "nwb");
    assert.deepEqual(Array.from(normalized.frames[0].samples), [2.5, 0, -1.875]);
    assert.deepEqual(Array.from(normalized.frames[1].samples), [-2.5, -0.625, 0]);
  });

  it("converts two-dimensional NWB data from time-major to channel-major samples", () => {
    const converted = toChannelMajorSamples({
      data: new Float32Array([1, 10, 2, 20, 3, 30]),
      shape: [3, 2],
    });

    assert.equal(converted.channelCount, 2);
    assert.equal(converted.sampleCount, 3);
    assert.deepEqual(Array.from(converted.samples), [1, 2, 3, 10, 20, 30]);
  });
});
