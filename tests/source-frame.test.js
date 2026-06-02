import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  channelTraceFromFrame,
  cloneSourceFrame,
  copyChannelGroupToSamples,
  makeSourceFrame,
} from "../src/data/frame-utils.js";
import { detectFrameCrossings } from "../src/crossing-detection.js";

describe("normalized source frames", () => {
  it("builds one channel-major frame contract for every adapter", () => {
    const samples = new Float32Array(4 * 3);
    copyChannelGroupToSamples({
      target: samples,
      source: new Float32Array([1, 2, 3, 4, 5, 6]),
      groupIndex: 1,
      groupSize: 2,
      sampleCount: 3,
    });

    const frame = makeSourceFrame({
      sourceKind: "frozen",
      tStart: 10,
      tEnd: 20,
      channelCount: 4,
      sampleCount: 3,
      sampleRateHz: 300,
      units: "uV",
      samples,
      availableChannels: new Uint8Array([0, 0, 1, 1]),
    });

    assert.equal(frame.sourceKind, "frozen");
    assert.equal(frame.channelCount, 4);
    assert.equal(frame.sampleCount, 3);
    assert.equal(frame.samples.length, 12);
    assert.equal(frame.timestamp.getTime(), 20);
    assert.deepEqual(Array.from(channelTraceFromFrame(frame, 2)), [1, 2, 3]);
    assert.equal(channelTraceFromFrame(frame, 0), null);
  });

  it("clones mutable frame buffers before adapters reuse them", () => {
    const frame = makeSourceFrame({
      sourceKind: "demo",
      tStart: 0,
      tEnd: 4,
      channelCount: 1,
      sampleCount: 4,
      sampleRateHz: 1000,
      units: "uV",
      samples: new Float32Array([0, 1, 2, 3]),
    });

    const clone = cloneSourceFrame(frame, { tStart: 100, tEnd: 104 });
    clone.samples[0] = 99;

    assert.equal(frame.samples[0], 0);
    assert.equal(clone.tStart, 100);
    assert.equal(clone.tEnd, 104);
  });

  it("detects threshold crossings from normalized frames and skips unavailable channels", () => {
    const frame = makeSourceFrame({
      sourceKind: "demo",
      tStart: 0,
      tEnd: 4,
      channelCount: 2,
      sampleCount: 4,
      sampleRateHz: 1000,
      units: "uV",
      samples: new Float32Array([0, 2, 6, 2, 0, 9, 0, 0]),
      availableChannels: new Uint8Array([1, 0]),
    });

    const crossings = detectFrameCrossings(frame, {
      thresholdUv: 5,
      sampleRateHz: frame.sampleRateHz,
      refractoryMs: 2,
    });

    assert.equal(crossings.length, 1);
    assert.equal(crossings[0].absoluteChannel, 0);
    assert.equal(crossings[0].sampleIndex, 2);
  });
});
