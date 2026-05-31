export function decodeBase64Float32(base64) {
  const binary = decodeBase64ToBinary(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Float32Array(bytes.buffer);
}

export function normalizeReplayPayload(payload) {
  if (!payload || !Array.isArray(payload.samples)) {
    throw new TypeError("Replay payload must contain a samples array");
  }

  return {
    sampleWindowMs: payload.sampleWindowMs,
    sampleRateHz: payload.sampleRateHz,
    capturedAt: payload.capturedAt ?? null,
    source: payload.source ?? "unknown",
    meas: payload.samples.map((sample) => ({
      meaId: sample.meaId,
      data: decodeBase64Float32(sample.base64Float32LE),
    })),
  };
}

function decodeBase64ToBinary(base64) {
  if (typeof atob === "function") {
    return atob(base64);
  }
  if (typeof Buffer === "function") {
    return Buffer.from(base64, "base64").toString("binary");
  }
  throw new Error("No base64 decoder is available in this runtime");
}
