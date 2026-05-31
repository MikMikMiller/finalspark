import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHANNEL_COUNT,
  CHANNELS_PER_MEA,
  MEA_COUNT,
  mapChannel,
  channelsForMea,
  electrodeGridForMea,
} from "../src/mapping.js";

describe("channel mapping", () => {
  it("maps absolute channel 0 to MEA 1 local electrode 0", () => {
    assert.deepEqual(mapChannel(0), {
      absoluteIndex: 0,
      meaId: 1,
      meaIndex: 0,
      localIndex: 0,
      biochipIndex: 0,
      electrodeInBiochip: 0,
      x: 0,
      y: 0,
    });
  });

  it("keeps MEA-local and absolute indices separate at MEA boundaries", () => {
    assert.equal(CHANNEL_COUNT, 128);
    assert.equal(MEA_COUNT, 4);
    assert.equal(CHANNELS_PER_MEA, 32);

    assert.deepEqual(mapChannel(31), {
      absoluteIndex: 31,
      meaId: 1,
      meaIndex: 0,
      localIndex: 31,
      biochipIndex: 3,
      electrodeInBiochip: 7,
      x: 7,
      y: 3,
    });

    assert.deepEqual(mapChannel(32), {
      absoluteIndex: 32,
      meaId: 2,
      meaIndex: 1,
      localIndex: 0,
      biochipIndex: 0,
      electrodeInBiochip: 0,
      x: 0,
      y: 0,
    });
  });

  it("creates 32 stable absolute channels per MEA", () => {
    assert.equal(channelsForMea(3).length, 32);
    assert.equal(channelsForMea(3)[0].absoluteIndex, 64);
    assert.equal(channelsForMea(3)[31].absoluteIndex, 95);
  });

  it("lays a MEA out as a logical 8 by 4 grid without changing channel identity", () => {
    const grid = electrodeGridForMea(2);

    assert.equal(grid.length, 4);
    assert.equal(grid[0].length, 8);
    assert.equal(grid[0][0].absoluteIndex, 32);
    assert.equal(grid[0][4].absoluteIndex, 40);
    assert.equal(grid[3][7].absoluteIndex, 63);
  });

  it("rejects invalid absolute channels", () => {
    assert.throws(() => mapChannel(-1), /absolute channel/i);
    assert.throws(() => mapChannel(128), /absolute channel/i);
  });
});
