import { SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js";

export function makeFrame({ source, meas, timestamp = new Date(), sampleRateHz, sampleWindowMs }) {
  const sorted = meas
    .filter((mea) => mea && mea.data instanceof Float32Array)
    .slice()
    .sort((a, b) => a.meaId - b.meaId);

  return {
    source,
    timestamp,
    sampleRateHz: sampleRateHz ?? SAMPLE_RATE_HZ,
    sampleWindowMs: sampleWindowMs ?? SAMPLE_WINDOW_MS,
    meas: sorted,
  };
}

export function cloneMeaSample(mea) {
  return {
    meaId: mea.meaId,
    data: new Float32Array(mea.data),
  };
}

export function channelTraceFromFrame(frame, absoluteChannel) {
  const meaId = Math.floor(absoluteChannel / 32) + 1;
  const localIndex = absoluteChannel % 32;
  const mea = frame.meas.find((candidate) => candidate.meaId === meaId);
  if (!mea) return null;

  return mea.data.subarray(localIndex * 4096, localIndex * 4096 + 4096);
}
