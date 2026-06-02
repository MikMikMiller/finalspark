import { SAMPLE_COUNT } from "../config.js?v=20260602-nwb";
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
  sampleRateHz,
  startingTimeSeconds = null,
  units = "uV",
  frameSampleCount = SAMPLE_COUNT,
  sourceProvenance = {},
}) {
  if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    throw new TypeError("NWB TimeSeries must expose a finite positive starting_time rate");
  }

  const converted = toChannelMajorSamples({ data, shape });
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
    sourceKind: SOURCE_KIND,
    label: `NWB ${path}`,
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
    }),
  };
}

export function toChannelMajorSamples({ data, shape }) {
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
  sourceProvenance = {},
} = {}) {
  const series = findFirstReadableSeries(file);
  const data = series.group.get("data");
  const startingTime = series.group.get("starting_time");
  const rate = readAttributeValue(startingTime, "rate");
  const startingTimeValue = readDatasetValue(startingTime);

  return normalizeNwbTimeSeries({
    path: series.path,
    neurodataType: readAttributeValue(series.group, "neurodata_type"),
    data: readDatasetValue(data),
    shape: data.shape,
    sampleRateHz: Number(rate),
    startingTimeSeconds: Number(firstScalar(startingTimeValue)),
    units: String(readAttributeValue(data, "unit") ?? "uV"),
    frameSampleCount,
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
      sourceKind: SOURCE_KIND,
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
  const acquisition = file.get("acquisition");
  for (const name of acquisition.keys()) {
    const path = `acquisition/${name}`;
    const group = file.get(path);
    if (hasTimeSeriesData(group)) return { path, group };
  }
  throw new Error("No readable NWB acquisition TimeSeries with data and starting_time was found");
}

function hasTimeSeriesData(group) {
  if (!group || typeof group.keys !== "function") return false;
  const keys = new Set(group.keys());
  return keys.has("data") && keys.has("starting_time");
}

function readDatasetValue(dataset) {
  if (dataset?.value !== undefined) return dataset.value;
  if (typeof dataset?.to_array === "function") return dataset.to_array();
  throw new TypeError("NWB dataset value is not readable");
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
