import { SAMPLE_COUNT } from "../config.js?v=20260602-nwb-url-default";
import {
  createLogicalLayout,
  makeSourceFrame,
  makeSourceMeta,
} from "./frame-utils.js?v=20260601-perf";

const SOURCE_KIND = "nwb";

export function normalizeNwbTimeSeries({
  path,
  neurodataType = null,
  data,
  shape,
  storageOrder = null,
  sampleRateHz,
  startingTimeSeconds = null,
  units = "uV",
  frameSampleCount = SAMPLE_COUNT,
  sourceKind = SOURCE_KIND,
  sourceProvenance = {},
}) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new TypeError("NWB TimeSeries must expose a finite positive starting_time rate");
  }

  const converted = toChannelMajorSamples({ data, shape, storageOrder });
  const samplesPerFrame = normalizeFrameSampleCount(frameSampleCount, converted.sampleCount);
  const sampleWindowMs = (samplesPerFrame / sampleRateHz) * 1000;
  const provenance = {
    ...sourceProvenance,
    format: "NWB",
    seriesPath: path,
    neurodataType,
    recordingStartSeconds: Number.isFinite(startingTimeSeconds) ? startingTimeSeconds : null,
  };
  const meta = makeSourceMeta({
    sourceKind,
    label: `${sourceKind === SOURCE_KIND ? "NWB" : "Remote NWB"} ${path}`,
    channelCount: converted.channelCount,
    sampleRateHz,
    sampleCount: samplesPerFrame,
    sampleWindowMs,
    units,
    layout: createLogicalLayout({
      channelCount: converted.channelCount,
      groupCount: 1,
      channelsPerGroup: converted.channelCount,
      groupLabel: "NWB channel group",
    }),
    sourceProvenance: provenance,
  });

  return {
    meta,
    frames: buildFrames({
      samples: converted.samples,
      channelCount: converted.channelCount,
      sampleCount: converted.sampleCount,
      samplesPerFrame,
      sampleRateHz,
      units,
      meta,
      sourceKind,
    }),
  };
}

export function toChannelMajorSamples({ data, shape, storageOrder = null }) {
  const dimensions = Array.from(shape ?? []);
  const values = toFloat32Array(data);
  if (dimensions.length === 1) {
    const sampleCount = dimensions[0];
    if (values.length < sampleCount) throw new RangeError("NWB data length is shorter than its shape");
    return {
      channelCount: 1,
      sampleCount,
      samples: values.slice(0, sampleCount),
    };
  }

  if (dimensions.length !== 2) {
    throw new RangeError("Only one- and two-dimensional NWB TimeSeries data is supported");
  }

  const [first, second] = dimensions;
  if (values.length < first * second) throw new RangeError("NWB data length is shorter than its shape");

  if (storageOrder === "time-major") {
    return timeMajorToChannelMajor(values, first, second);
  }

  if (storageOrder === "channel-major") {
    return {
      channelCount: first,
      sampleCount: second,
      samples: values.slice(0, first * second),
    };
  }

  if (first >= second) {
    return timeMajorToChannelMajor(values, first, second);
  }

  return {
    channelCount: first,
    sampleCount: second,
    samples: values.slice(0, first * second),
  };
}

export function readNwbPayload(file, {
  frameSampleCount = SAMPLE_COUNT,
  maxDurationSeconds = null,
  maxSampleCount = null,
  sourceKind = SOURCE_KIND,
  sourceProvenance = {},
} = {}) {
  const series = findFirstReadableSeries(file);
  const data = series.group.get("data");
  const timing = readSeriesTiming(series.group);
  const excerpt = readTimeSeriesExcerpt(data, {
    maxSampleCount: resolveMaxSampleCount({
      sampleRateHz: timing.sampleRateHz,
      maxDurationSeconds,
      maxSampleCount,
    }),
  });

  return normalizeNwbTimeSeries({
    path: series.path,
    neurodataType: readAttributeValue(series.group, "neurodata_type"),
    data: excerpt.data,
    shape: excerpt.shape,
    storageOrder: excerpt.storageOrder,
    sampleRateHz: timing.sampleRateHz,
    startingTimeSeconds: timing.startingTimeSeconds,
    units: String(readAttributeValue(data, "unit") ?? "uV"),
    frameSampleCount,
    sourceKind,
    sourceProvenance: {
      ...sourceProvenance,
      conversion: numericOrNull(readAttributeValue(data, "conversion")),
    },
  });
}

function buildFrames({
  samples,
  channelCount,
  sampleCount,
  samplesPerFrame,
  sampleRateHz,
  units,
  meta,
  sourceKind = SOURCE_KIND,
}) {
  const frames = [];
  for (let offset = 0; offset < sampleCount; offset += samplesPerFrame) {
    const chunkSampleCount = Math.min(samplesPerFrame, sampleCount - offset);
    const chunk = new Float32Array(channelCount * chunkSampleCount);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sourceStart = channel * sampleCount + offset;
      const targetStart = channel * chunkSampleCount;
      chunk.set(samples.subarray(sourceStart, sourceStart + chunkSampleCount), targetStart);
    }

    const tStart = (offset / sampleRateHz) * 1000;
    const tEnd = ((offset + chunkSampleCount) / sampleRateHz) * 1000;
    frames.push(makeSourceFrame({
      sourceKind,
      tStart,
      tEnd,
      channelCount,
      sampleCount: chunkSampleCount,
      sampleRateHz,
      units,
      samples: chunk,
      meta,
    }));
  }
  return frames;
}

function readTimeSeriesExcerpt(dataset, { maxSampleCount = null } = {}) {
  const dimensions = Array.from(dataset.shape ?? []);
  if (!maxSampleCount) {
    return {
      data: readDatasetValue(dataset),
      shape: dimensions,
      storageOrder: null,
    };
  }

  if (dimensions.length === 1) {
    const sampleCount = Math.min(dimensions[0], maxSampleCount);
    return {
      data: readDatasetSlice(dataset, [[0, sampleCount]]),
      shape: [sampleCount],
      storageOrder: null,
    };
  }

  if (dimensions.length !== 2) {
    throw new RangeError("Only one- and two-dimensional NWB TimeSeries data is supported");
  }

  const [first, second] = dimensions;
  if (first >= second) {
    const sampleCount = Math.min(first, maxSampleCount);
    return {
      data: readDatasetSlice(dataset, [[0, sampleCount], []]),
      shape: [sampleCount, second],
      storageOrder: "time-major",
    };
  }

  const sampleCount = Math.min(second, maxSampleCount);
  return {
    data: readDatasetSlice(dataset, [[], [0, sampleCount]]),
    shape: [first, sampleCount],
    storageOrder: "channel-major",
  };
}

function resolveMaxSampleCount({ sampleRateHz, maxDurationSeconds, maxSampleCount }) {
  const explicit = Math.floor(Number(maxSampleCount));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const duration = Number(maxDurationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new TypeError("NWB TimeSeries must expose a finite positive sample rate");
  }
  return Math.max(1, Math.floor(sampleRateHz * duration));
}

function timeMajorToChannelMajor(values, sampleCount, channelCount) {
  const samples = new Float32Array(channelCount * sampleCount);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      samples[channel * sampleCount + sample] = values[sample * channelCount + channel];
    }
  }
  return { channelCount, sampleCount, samples };
}

function normalizeFrameSampleCount(frameSampleCount, availableSampleCount) {
  const requested = Math.floor(Number(frameSampleCount));
  if (!Number.isFinite(requested) || requested <= 0) return Math.max(1, availableSampleCount);
  return Math.max(1, Math.min(requested, availableSampleCount));
}

function toFloat32Array(data) {
  if (data instanceof Float32Array) return data;
  if (ArrayBuffer.isView(data)) return Float32Array.from(data);
  if (Array.isArray(data)) return Float32Array.from(data);
  throw new TypeError("NWB data must be an array or typed array");
}

function findFirstReadableSeries(file) {
  const candidates = findReadableSeriesCandidates(file);
  const best = candidates.sort(compareSeriesCandidates)[0];
  if (best) return best;
  throw new Error("No readable NWB TimeSeries with data and timing information was found");
}

function findReadableSeriesCandidates(file) {
  const roots = ["acquisition", "processing"];
  const candidates = [];
  for (const root of roots) {
    const group = safeGet(file, root);
    if (!group || typeof group.keys !== "function") continue;
    collectReadableSeries(file, root, group, candidates, 0);
  }
  return candidates;
}

function collectReadableSeries(file, path, group, candidates, depth) {
  if (hasTimeSeriesData(group)) {
    candidates.push({ path, group });
    return;
  }
  if (depth >= 5 || !group || typeof group.keys !== "function") return;
  for (const name of group.keys()) {
    const childPath = `${path}/${name}`;
    const child = safeGet(file, childPath);
    if (child && typeof child.keys === "function") {
      collectReadableSeries(file, childPath, child, candidates, depth + 1);
    }
  }
}

function compareSeriesCandidates(left, right) {
  return scoreSeriesCandidate(right) - scoreSeriesCandidate(left);
}

function scoreSeriesCandidate(candidate) {
  const neurodataType = String(readAttributeValue(candidate.group, "neurodata_type") ?? "");
  const data = candidate.group.get("data");
  const dimensions = Array.from(data?.shape ?? []);
  const channelCount = estimateChannelCount(dimensions);
  let score = 0;
  if (neurodataType === "ElectricalSeries") score += 1000;
  if (dimensions.length === 2) score += 200;
  if (candidate.path.startsWith("processing/")) score += 25;
  score += Math.min(channelCount, 128);
  return score;
}

function estimateChannelCount(dimensions) {
  if (dimensions.length === 1) return 1;
  if (dimensions.length !== 2) return 0;
  const [first, second] = dimensions;
  return Math.max(1, Math.min(first, second));
}

function hasTimeSeriesData(group) {
  if (!group || typeof group.keys !== "function") return false;
  const keys = new Set(group.keys());
  return keys.has("data") && (keys.has("starting_time") || keys.has("timestamps"));
}

function readSeriesTiming(group) {
  const keys = new Set(group.keys());
  if (keys.has("starting_time")) return readStartingTimeTiming(group.get("starting_time"));
  if (keys.has("timestamps")) return readTimestampTiming(group.get("timestamps"));
  throw new TypeError("NWB TimeSeries must expose starting_time or timestamps");
}

function readStartingTimeTiming(startingTime) {
  const sampleRateHz = Number(readAttributeValue(startingTime, "rate"));
  return {
    sampleRateHz,
    startingTimeSeconds: Number(firstScalar(readDatasetValue(startingTime))),
  };
}

function readTimestampTiming(timestamps) {
  const dimensions = Array.from(timestamps?.shape ?? []);
  const timestampCount = Math.floor(Number(dimensions[0]));
  if (!Number.isFinite(timestampCount) || timestampCount < 2) {
    throw new TypeError("NWB timestamps must contain at least two values to derive a sample rate");
  }

  const sample = Array.from(readDatasetSlice(timestamps, [[0, Math.min(timestampCount, 3)]]), Number);
  const first = sample[0];
  for (let index = 1; index < sample.length; index += 1) {
    const delta = (sample[index] - first) / index;
    if (Number.isFinite(delta) && delta > 0) {
      return {
        sampleRateHz: 1 / delta,
        startingTimeSeconds: first,
      };
    }
  }
  throw new TypeError("NWB timestamps must be increasing to derive a sample rate");
}

function safeGet(file, path) {
  try {
    return file.get(path);
  } catch {
    return null;
  }
}

function readDatasetValue(dataset) {
  if (dataset?.value !== undefined) return dataset.value;
  if (typeof dataset?.to_array === "function") return dataset.to_array();
  throw new TypeError("NWB dataset value is not readable");
}

function readDatasetSlice(dataset, ranges) {
  if (typeof dataset?.slice === "function") return dataset.slice(ranges);
  return readDatasetValue(dataset);
}

function readAttributeValue(object, name) {
  const attribute = object?.attrs?.[name];
  if (!attribute) return null;
  if (attribute.value !== undefined) return firstScalar(attribute.value);
  return firstScalar(attribute);
}

function firstScalar(value) {
  if (ArrayBuffer.isView(value)) return value[0] ?? null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
