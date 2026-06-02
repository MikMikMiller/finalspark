import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeSourceFrame, makeSourceMeta } from "../src/data/frame-utils.js";
import { NwbSource } from "../src/data/nwb-source.js";

describe("NwbSource", () => {
  it("implements the source adapter surface without core-specific knowledge", async () => {
    const meta = makeSourceMeta({
      sourceKind: "nwb",
      label: "NWB excerpt",
      channelCount: 1,
      sampleRateHz: 1000,
      sampleCount: 2,
      sampleWindowMs: 2,
      units: "uV",
      sourceProvenance: {
        format: "NWB",
        source: "fixture.nwb",
      },
    });
    const fixtureFrame = makeSourceFrame({
      sourceKind: "nwb",
      tStart: 0,
      tEnd: 2,
      channelCount: 1,
      sampleCount: 2,
      sampleRateHz: 1000,
      units: "uV",
      samples: new Float32Array([1, -1]),
      meta,
    });
    const source = new NwbSource({
      src: "fixture.nwb",
      loop: false,
      loadPayload: async () => ({ meta, frames: [fixtureFrame] }),
    });

    const frames = [];
    const statuses = [];
    await source.start(
      (frame) => frames.push(frame),
      (status) => statuses.push(status.message),
    );
    source.stop();

    assert.equal(source.meta(), meta);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].sourceKind, "nwb");
    assert.deepEqual(Array.from(frames[0].samples), [1, -1]);
    assert(statuses.some((message) => message.includes("Loading NWB source")));
    assert(statuses.some((message) => message.includes("NWB source is running locally")));
  });
});
