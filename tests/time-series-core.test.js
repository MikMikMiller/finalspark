import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { makeSourceFrame } from "../src/data/frame-utils.js";
import { TimeSeriesCore } from "../src/kernel/time-series-core.js";

function frameAt(tEnd) {
  return makeSourceFrame({
    sourceKind: "frozen",
    tStart: tEnd - 1000,
    tEnd,
    channelCount: 1,
    sampleCount: 2,
    sampleRateHz: 2,
    units: "uV",
    samples: new Float32Array([tEnd, tEnd + 1]),
  });
}

describe("time-series core", () => {
  it("stores a bounded rolling window of normalized frames", () => {
    const core = new TimeSeriesCore({ windowSeconds: 2 });

    core.pushFrame(frameAt(1000));
    core.pushFrame(frameAt(2000));
    core.pushFrame(frameAt(4000));

    assert.equal(core.latestFrame().tEnd, 4000);
    assert.deepEqual(core.frames().map((frame) => frame.tEnd), [2000, 4000]);
  });

  it("keeps source-specific transport terms out of the core", async () => {
    const source = await readFile(new URL("../src/kernel/time-series-core.js", import.meta.url), "utf8");

    assert.doesNotMatch(source, /FinalSpark|Socket\.IO|MEA|meaid/i);
  });
});
