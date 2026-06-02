import { SAMPLE_COUNT, SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js?v=20260601-perf";
import { CHANNEL_COUNT, CHANNELS_PER_MEA } from "../mapping.js?v=20260601-perf";
import {
  copyChannelGroupToSamples,
  createLogicalLayout,
  makeSourceFrame,
  makeSourceMeta,
} from "./frame-utils.js?v=20260601-perf";

export function decodeBase64Float32(base64) {
  const binary = decodeBase64ToBinary(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Float32Array(bytes.buffer);
}

export function normalizeFrozenPayload(payload) {
  if (!payload || !Array.isArray(payload.samples)) {
    throw new TypeError("Frozen payload must contain a samples array");
  }

  const sampleRateHz = Number(payload.sampleRateHz) || SAMPLE_RATE_HZ;
  const sampleWindowMs = Number(payload.sampleWindowMs) || SAMPLE_WINDOW_MS;
  const sampleCount = inferSampleCount(payload.samples) ?? SAMPLE_COUNT;
  const samples = new Float32Array(CHANNEL_COUNT * sampleCount);
  const availableChannels = new Uint8Array(CHANNEL_COUNT);

  for (const sample of payload.samples) {
    const groupIndex = Number(sample.meaId) - 1;
    if (!Number.isInteger(groupIndex) || groupIndex < 0) continue;
    const data = decodeBase64Float32(sample.base64Float32LE);
    copyChannelGroupToSamples({
      target: samples,
      source: data,
      groupIndex,
      groupSize: CHANNELS_PER_MEA,
      sampleCount,
    });
    availableChannels.fill(1, groupIndex * CHANNELS_PER_MEA, (groupIndex + 1) * CHANNELS_PER_MEA);
  }

  const meta = makeSourceMeta({
    sourceKind: "frozen",
    label: "Frozen public-stream capture",
    channelCount: CHANNEL_COUNT,
    sampleRateHz,
    sampleCount,
    sampleWindowMs,
    units: "uV",
    layout: createLogicalLayout(),
    sourceProvenance: {
      publicStreamOnly: true,
      capturedAt: payload.capturedAt ?? null,
      source: payload.source ?? null,
      transport: payload.transport ?? null,
    },
  });

  return {
    meta,
    frames: [
      makeSourceFrame({
        sourceKind: "frozen",
        tStart: 0,
        tEnd: sampleWindowMs,
        channelCount: CHANNEL_COUNT,
        sampleCount,
        sampleRateHz,
        units: meta.units,
        samples,
        availableChannels,
        meta,
      }),
    ],
  };
}

function inferSampleCount(samples) {
  const first = samples.find((sample) => sample?.base64Float32LE);
  if (!first) return null;
  return decodeBase64Float32(first.base64Float32LE).length / CHANNELS_PER_MEA;
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
