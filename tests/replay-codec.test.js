import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decodeBase64Float32,
  normalizeReplayPayload,
} from "../src/data/replay-codec.js";

describe("replay fixture decoding", () => {
  it("decodes base64 float32 payloads", () => {
    const floats = new Float32Array([1.5, -2, 3.25]);
    const encoded = Buffer.from(floats.buffer).toString("base64");

    assert.deepEqual(Array.from(decodeBase64Float32(encoded)), [1.5, -2, 3.25]);
  });

  it("normalizes the captured four-MEA replay schema", () => {
    const floats = new Float32Array(32 * 4096);
    floats[0] = 42;
    const encoded = Buffer.from(floats.buffer).toString("base64");
    const payload = {
      sampleWindowMs: 1092.3,
      sampleRateHz: 3750.801978,
      samples: [1, 2, 3, 4].map((meaId) => ({
        meaId,
        base64Float32LE: encoded,
      })),
    };

    const normalized = normalizeReplayPayload(payload);

    assert.equal(normalized.sampleWindowMs, 1092.3);
    assert.equal(normalized.sampleRateHz, 3750.801978);
    assert.equal(normalized.meas.length, 4);
    assert.equal(normalized.meas[0].meaId, 1);
    assert.equal(normalized.meas[0].data.length, 32 * 4096);
    assert.equal(normalized.meas[0].data[0], 42);
  });
});
