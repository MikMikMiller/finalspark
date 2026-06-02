import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  computeCenterOfActivity,
  computeCrossingRates,
  computePopulationActivity,
  splitCountsByLayout,
} from "../src/metrics.js";
import { channelsForMea } from "../src/mapping.js";

describe("derived activity metrics", () => {
  it("converts crossing counts to per-channel rates", () => {
    const rates = computeCrossingRates(Uint16Array.from([0, 2, 4]), 1000);

    assert.deepEqual(Array.from(rates), [0, 2, 4]);
  });

  it("computes center of activity as a crossing-count weighted electrode position", () => {
    const counts = new Uint16Array(32);
    counts[0] = 1;
    counts[7] = 3;

    const center = computeCenterOfActivity(counts, channelsForMea(1));

    assert.deepEqual(center, {
      active: true,
      x: 2.25,
      y: 0.75,
      totalCrossings: 4,
    });
  });

  it("returns inactive center of activity when no threshold crossings exist", () => {
    assert.deepEqual(computeCenterOfActivity(new Uint16Array(32), channelsForMea(1)), {
      active: false,
      x: null,
      y: null,
      totalCrossings: 0,
    });
  });

  it("summarizes population activity across all 128 channels", () => {
    const counts = new Uint16Array(128);
    counts[0] = 2;
    counts[64] = 1;

    assert.deepEqual(computePopulationActivity(counts, 1092.3), {
      activeChannels: 2,
      totalCrossings: 3,
      populationRateHz: 2.746,
      meanChannelRateHz: 0.021,
    });
  });

  it("splits crossing counts by generic layout groups", () => {
    const counts = new Uint16Array([1, 2, 3, 4, 5]);
    const groups = splitCountsByLayout(counts, {
      groups: [
        { id: 1, label: "Group A", startChannel: 0, channelCount: 2 },
        { id: 2, label: "Group B", startChannel: 2, channelCount: 3 },
      ],
    });

    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, "Group A");
    assert.deepEqual(Array.from(groups[0].counts), [1, 2]);
    assert.equal(groups[1].label, "Group B");
    assert.deepEqual(Array.from(groups[1].counts), [3, 4, 5]);
  });
});
