import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeBase64Float32, normalizeFrozenPayload } from "../src/data/frozen-codec.js";

describe("frozen source codec", () => {
  it("normalizes the captured public-stream fixture into generic metadata and frames", () => {
    const floats = new Float32Array(32 * 4);
    floats[0] = 42;
    floats[4] = -7;
    const encoded = Buffer.from(floats.buffer).toString("base64");
    const payload = {
      source: "https://livemeaservice.finalspark.com",
      transport: "Socket.IO websocket, EIO=4",
      capturedAt: "2026-05-31T20:21:13.222Z",
      sampleWindowMs: 1000,
      sampleRateHz: 4,
      samples: [1, 2].map((meaId) => ({
        meaId,
        base64Float32LE: encoded,
      })),
    };

    const normalized = normalizeFrozenPayload(payload);

    assert.equal(normalized.meta.sourceKind, "frozen");
    assert.equal(normalized.meta.channelCount, 128);
    assert.equal(normalized.meta.sampleRateHz, 4);
    assert.equal(normalized.meta.units, "uV");
    assert.equal(normalized.meta.sourceProvenance.publicStreamOnly, true);
    assert.equal(normalized.frames.length, 1);
    assert.equal(normalized.frames[0].sourceKind, "frozen");
    assert.equal(normalized.frames[0].samples[0], 42);
    assert.equal(normalized.frames[0].samples[4], -7);
    assert.equal(normalized.frames[0].samples[32 * 4], 42);
  });

  it("decodes base64 float32 payloads", () => {
    const floats = new Float32Array([1.5, -2, 3.25]);
    const encoded = Buffer.from(floats.buffer).toString("base64");

    assert.deepEqual(Array.from(decodeBase64Float32(encoded)), [1.5, -2, 3.25]);
  });
});
