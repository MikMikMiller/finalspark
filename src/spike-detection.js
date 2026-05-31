import { CHANNEL_COUNT } from "./mapping.js";

const DEFAULT_REFRACTORY_MS = 2;

export function detectThresholdCrossings(trace, options) {
  const {
    absoluteChannel,
    thresholdUv,
    sampleRateHz,
    refractoryMs = DEFAULT_REFRACTORY_MS,
  } = options;

  if (!(trace instanceof Float32Array) && !Array.isArray(trace)) {
    throw new TypeError("trace must be a Float32Array or Array");
  }
  if (!Number.isFinite(thresholdUv) || thresholdUv <= 0) {
    throw new RangeError("thresholdUv must be a positive number");
  }
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new RangeError("sampleRateHz must be a positive number");
  }

  const crossings = [];
  const refractorySamples = Math.max(1, Math.round((refractoryMs / 1000) * sampleRateHz));
  let lastCrossingSample = -Infinity;
  let previousAbs = Math.abs(trace[0] ?? 0);

  for (let sampleIndex = 1; sampleIndex < trace.length; sampleIndex += 1) {
    const value = trace[sampleIndex];
    const absValue = Math.abs(value);
    const crossed = previousAbs < thresholdUv && absValue >= thresholdUv;
    const outsideRefractory = sampleIndex - lastCrossingSample >= refractorySamples;

    if (crossed && outsideRefractory) {
      crossings.push({
        absoluteChannel,
        sampleIndex,
        timeMs: round((sampleIndex / sampleRateHz) * 1000, 3),
        amplitudeUv: round(value, 3),
        polarity: value >= 0 ? "positive" : "negative",
      });
      lastCrossingSample = sampleIndex;
    }

    previousAbs = absValue;
  }

  return crossings;
}

export function countSpikesByChannel(crossings, channelCount = CHANNEL_COUNT) {
  const counts = new Uint16Array(channelCount);
  for (const crossing of crossings) {
    if (
      Number.isInteger(crossing.absoluteChannel) &&
      crossing.absoluteChannel >= 0 &&
      crossing.absoluteChannel < channelCount
    ) {
      counts[crossing.absoluteChannel] += 1;
    }
  }
  return counts;
}

export function summarizeNoiseBand(trace) {
  const values = Array.from(trace).filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length === 0) {
    return { centerUv: 0, madUv: 0, noiseFloorUv: 0 };
  }

  const center = median(values);
  const deviations = values.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
  const mad = median(deviations);

  return {
    centerUv: round(center, 3),
    madUv: round(mad, 3),
    noiseFloorUv: round(1.4826 * mad, 3),
  };
}

export function detectFrameCrossings(meas, options) {
  const crossings = [];
  for (const mea of meas) {
    const baseChannel = (mea.meaId - 1) * 32;
    for (let localIndex = 0; localIndex < 32; localIndex += 1) {
      const start = localIndex * 4096;
      const trace = mea.data.subarray(start, start + 4096);
      crossings.push(
        ...detectThresholdCrossings(trace, {
          ...options,
          absoluteChannel: baseChannel + localIndex,
        }),
      );
    }
  }
  return crossings;
}

function median(sortedValues) {
  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle];
  }
  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
