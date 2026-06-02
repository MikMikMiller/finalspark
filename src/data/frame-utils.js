import { SAMPLE_COUNT, SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js?v=20260601-perf";
import { CHANNEL_COUNT, CHANNELS_PER_MEA, MEA_COUNT } from "../mapping.js?v=20260601-perf";

export function makeSourceMeta({
  sourceKind,
  label,
  channelCount = CHANNEL_COUNT,
  sampleRateHz = SAMPLE_RATE_HZ,
  sampleCount = SAMPLE_COUNT,
  sampleWindowMs = (sampleCount / sampleRateHz) * 1000,
  units = "uV",
  layout = createLogicalLayout(),
  sourceProvenance = null,
} = {}) {
  return {
    channelCount,
    sampleRateHz,
    sampleCount,
    sampleWindowMs,
    units,
    layout,
    sourceKind,
    label,
    sourceProvenance,
  };
}

export function createLogicalLayout({
  channelCount = CHANNEL_COUNT,
  groupCount = MEA_COUNT,
  channelsPerGroup = CHANNELS_PER_MEA,
  groupLabel = "MEA",
} = {}) {
  return {
    kind: "logical-electrode-grid",
    channelCount,
    groups: Array.from({ length: groupCount }, (_, groupIndex) => ({
      id: groupIndex + 1,
      label: `${groupLabel} ${groupIndex + 1}`,
      startChannel: groupIndex * channelsPerGroup,
      channelCount: channelsPerGroup,
    })),
  };
}

export function makeSourceFrame({
  sourceKind,
  tStart,
  tEnd,
  channelCount = CHANNEL_COUNT,
  sampleCount = SAMPLE_COUNT,
  sampleRateHz = SAMPLE_RATE_HZ,
  units = "uV",
  samples,
  availableChannels,
  meta = null,
  timestamp = new Date(tEnd),
}) {
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || tEnd < tStart) {
    throw new RangeError("tStart and tEnd must be finite ascending millisecond values");
  }
  if (!Number.isInteger(channelCount) || channelCount <= 0) {
    throw new RangeError("channelCount must be a positive integer");
  }
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new RangeError("sampleCount must be a positive integer");
  }
  if (!(samples instanceof Float32Array)) {
    throw new TypeError("samples must be a Float32Array");
  }
  if (samples.length !== channelCount * sampleCount) {
    throw new RangeError(`samples length must be ${channelCount * sampleCount}`);
  }

  const availability = availableChannels
    ? Uint8Array.from(availableChannels)
    : new Uint8Array(channelCount).fill(1);
  if (availability.length !== channelCount) {
    throw new RangeError(`availableChannels length must be ${channelCount}`);
  }

  return {
    sourceKind,
    tStart,
    tEnd,
    timestamp,
    channelCount,
    sampleCount,
    sampleRateHz,
    sampleWindowMs: tEnd - tStart,
    units,
    samples,
    availableChannels: availability,
    meta,
  };
}

export function cloneSourceFrame(frame, overrides = {}) {
  return makeSourceFrame({
    sourceKind: overrides.sourceKind ?? frame.sourceKind,
    tStart: overrides.tStart ?? frame.tStart,
    tEnd: overrides.tEnd ?? frame.tEnd,
    channelCount: frame.channelCount,
    sampleCount: frame.sampleCount,
    sampleRateHz: frame.sampleRateHz,
    units: frame.units,
    samples: new Float32Array(frame.samples),
    availableChannels: new Uint8Array(frame.availableChannels),
    meta: overrides.meta ?? frame.meta,
    timestamp: overrides.timestamp ?? frame.timestamp,
  });
}

export function copyChannelGroupToSamples({
  target,
  source,
  groupIndex,
  groupSize = CHANNELS_PER_MEA,
  sampleCount = SAMPLE_COUNT,
}) {
  if (!(target instanceof Float32Array) || !(source instanceof Float32Array)) {
    throw new TypeError("target and source must be Float32Array instances");
  }
  if (!Number.isInteger(groupIndex) || groupIndex < 0) {
    throw new RangeError("groupIndex must be a non-negative integer");
  }

  const expectedSourceLength = groupSize * sampleCount;
  if (source.length !== expectedSourceLength) {
    throw new RangeError(`source length must be ${expectedSourceLength}`);
  }

  const channelOffset = groupIndex * groupSize;
  for (let localIndex = 0; localIndex < groupSize; localIndex += 1) {
    const sourceStart = localIndex * sampleCount;
    const targetStart = (channelOffset + localIndex) * sampleCount;
    target.set(source.subarray(sourceStart, sourceStart + sampleCount), targetStart);
  }
}

export function channelTraceFromFrame(frame, absoluteChannel) {
  if (
    !frame ||
    !Number.isInteger(absoluteChannel) ||
    absoluteChannel < 0 ||
    absoluteChannel >= frame.channelCount
  ) {
    return null;
  }
  if (frame.availableChannels?.[absoluteChannel] === 0) return null;

  const start = absoluteChannel * frame.sampleCount;
  return frame.samples.subarray(start, start + frame.sampleCount);
}

export function makeFrame({ source, meas, timestamp = new Date(), sampleRateHz, sampleWindowMs }) {
  const rate = sampleRateHz ?? SAMPLE_RATE_HZ;
  const windowMs = sampleWindowMs ?? SAMPLE_WINDOW_MS;
  const tEnd = timestamp.getTime();
  const samples = new Float32Array(CHANNEL_COUNT * SAMPLE_COUNT);
  const availableChannels = new Uint8Array(CHANNEL_COUNT);

  for (const mea of meas ?? []) {
    if (!mea || !(mea.data instanceof Float32Array)) continue;
    const groupIndex = mea.meaId - 1;
    copyChannelGroupToSamples({ target: samples, source: mea.data, groupIndex });
    availableChannels.fill(1, groupIndex * CHANNELS_PER_MEA, (groupIndex + 1) * CHANNELS_PER_MEA);
  }

  return makeSourceFrame({
    sourceKind: source,
    tStart: tEnd - windowMs,
    tEnd,
    channelCount: CHANNEL_COUNT,
    sampleCount: SAMPLE_COUNT,
    sampleRateHz: rate,
    units: "uV",
    samples,
    availableChannels,
  });
}

export function cloneMeaSample(mea) {
  return {
    meaId: mea.meaId,
    data: new Float32Array(mea.data),
  };
}
