import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeNwbTimeSeries,
  readNwbPayload,
  toChannelMajorSamples,
} from "../src/data/nwb-codec.js";

describe("NWB source codec", () => {
  it("normalizes a one-dimensional NWB TimeSeries into generic source frames", () => {
    const normalized = normalizeNwbTimeSeries({
      path: "acquisition/data_00000_AD0",
      neurodataType: "VoltageClampSeries",
      data: new Float32Array([2.5, 0, -1.875, -2.5, -0.625, 0]),
      shape: [6],
      sampleRateHz: 200000,
      startingTimeSeconds: 294.2589998245239,
      units: "amperes",
      frameSampleCount: 3,
      sourceProvenance: {
        source: "dandi:000020",
      },
    });

    assert.equal(normalized.meta.sourceKind, "nwb");
    assert.equal(normalized.meta.channelCount, 1);
    assert.equal(normalized.meta.sampleCount, 3);
    assert.equal(normalized.meta.sampleRateHz, 200000);
    assert.equal(normalized.meta.units, "amperes");
    assert.equal(normalized.meta.sourceProvenance.format, "NWB");
    assert.equal(normalized.meta.sourceProvenance.seriesPath, "acquisition/data_00000_AD0");
    assert.equal(normalized.meta.sourceProvenance.neurodataType, "VoltageClampSeries");
    assert.equal(normalized.meta.sourceProvenance.recordingStartSeconds, 294.2589998245239);
    assert.equal(normalized.frames.length, 2);
    assert.equal(normalized.frames[0].sourceKind, "nwb");
    assert.deepEqual(Array.from(normalized.frames[0].samples), [2.5, 0, -1.875]);
    assert.deepEqual(Array.from(normalized.frames[1].samples), [-2.5, -0.625, 0]);
  });

  it("converts two-dimensional NWB data from time-major to channel-major samples", () => {
    const converted = toChannelMajorSamples({
      data: new Float32Array([1, 10, 2, 20, 3, 30]),
      shape: [3, 2],
    });

    assert.equal(converted.channelCount, 2);
    assert.equal(converted.sampleCount, 3);
    assert.deepEqual(Array.from(converted.samples), [1, 2, 3, 10, 20, 30]);
  });

  it("reads bounded time-major excerpts with dataset slicing", () => {
    const sliceCalls = [];
    const { file } = makeReadableNwbFile({
      dataShape: [6, 2],
      slicedData: new Float32Array([1, 10, 2, 20]),
      onSlice: (ranges) => sliceCalls.push(ranges),
    });

    const normalized = readNwbPayload(file, {
      frameSampleCount: 2,
      maxDurationSeconds: 0.002,
    });

    assert.deepEqual(sliceCalls, [[ [0, 2], [] ]]);
    assert.equal(normalized.meta.channelCount, 2);
    assert.equal(normalized.meta.sampleCount, 2);
    assert.equal(normalized.frames.length, 1);
    assert.deepEqual(Array.from(normalized.frames[0].samples), [1, 2, 10, 20]);
  });

  it("reads bounded channel-major excerpts with dataset slicing", () => {
    const sliceCalls = [];
    const { file } = makeReadableNwbFile({
      dataShape: [2, 6],
      slicedData: new Float32Array([1, 2, 10, 20]),
      onSlice: (ranges) => sliceCalls.push(ranges),
    });

    const normalized = readNwbPayload(file, {
      frameSampleCount: 2,
      maxSampleCount: 2,
    });

    assert.deepEqual(sliceCalls, [[ [], [0, 2] ]]);
    assert.equal(normalized.meta.channelCount, 2);
    assert.equal(normalized.meta.sampleCount, 2);
    assert.deepEqual(Array.from(normalized.frames[0].samples), [1, 2, 10, 20]);
  });

  it("prefers multichannel ElectricalSeries outside acquisition over a one-dimensional acquisition series", () => {
    const file = makeMultiSeriesNwbFile();

    const normalized = readNwbPayload(file, {
      frameSampleCount: 2,
      maxSampleCount: 2,
    });

    assert.equal(normalized.meta.sourceProvenance.seriesPath, "processing/ecephys/Processed/ProcessedGPe");
    assert.equal(normalized.meta.channelCount, 3);
    assert.equal(normalized.meta.sampleRateHz, 24414.0625);
    assert.deepEqual(Array.from(normalized.frames[0].samples), [1, 2, 10, 20, 100, 200]);
  });

  it("reads multichannel TimeSeries that expose timestamps instead of starting_time", () => {
    const dataSliceCalls = [];
    const timestampSliceCalls = [];
    const file = makeTimestampedNwbFile({ dataSliceCalls, timestampSliceCalls });

    const normalized = readNwbPayload(file, {
      frameSampleCount: 2,
      maxSampleCount: 2,
    });

    assert.deepEqual(timestampSliceCalls, [[ [0, 3] ]]);
    assert.deepEqual(dataSliceCalls, [[ [0, 2], [] ]]);
    assert.equal(normalized.meta.channelCount, 3);
    assert.ok(Math.abs(normalized.meta.sampleRateHz - 1250) < 1e-9);
    assert.equal(normalized.meta.sourceProvenance.recordingStartSeconds, 0.625);
    assert.deepEqual(Array.from(normalized.frames[0].samples), [1, 2, 10, 20, 100, 200]);
  });
});

function makeReadableNwbFile({ dataShape, slicedData, onSlice }) {
  const data = {
    shape: dataShape,
    attrs: {
      unit: { value: "microvolts" },
      conversion: { value: 1 },
    },
    slice(ranges) {
      onSlice(ranges);
      return slicedData;
    },
    get value() {
      throw new Error("full dataset read should not be used for bounded excerpts");
    },
  };
  const startingTime = {
    value: new Float64Array([0]),
    attrs: {
      rate: { value: new Float64Array([1000]) },
    },
  };
  const series = {
    attrs: {
      neurodata_type: { value: "ElectricalSeries" },
    },
    keys() {
      return ["data", "starting_time"];
    },
    get(name) {
      if (name === "data") return data;
      if (name === "starting_time") return startingTime;
      return null;
    },
  };
  const acquisition = {
    keys() {
      return ["series"];
    },
  };

  return {
    file: {
      get(path) {
        if (path === "acquisition") return acquisition;
        if (path === "acquisition/series") return series;
        return null;
      },
    },
  };
}

function makeMultiSeriesNwbFile() {
  const oneDimensionalAcquisition = makeSeriesGroup({
    neurodataType: "SpatialSeries",
    dataShape: [10],
    slicedData: new Float32Array([99, 99]),
    rate: 4800,
  });
  const processedElectrical = makeSeriesGroup({
    neurodataType: "ElectricalSeries",
    dataShape: [6, 3],
    slicedData: new Float32Array([1, 10, 100, 2, 20, 200]),
    rate: 24414.0625,
  });

  const groups = new Map([
    ["acquisition", makeContainer(["SpatialSeries"])],
    ["acquisition/SpatialSeries", oneDimensionalAcquisition],
    ["processing", makeContainer(["ecephys"])],
    ["processing/ecephys", makeContainer(["Processed"])],
    ["processing/ecephys/Processed", makeContainer(["ProcessedGPe"])],
    ["processing/ecephys/Processed/ProcessedGPe", processedElectrical],
  ]);

  return {
    get(path) {
      return groups.get(path) ?? null;
    },
  };
}

function makeTimestampedNwbFile({ dataSliceCalls, timestampSliceCalls }) {
  const data = {
    shape: [6, 3],
    attrs: {
      unit: { value: "volts" },
      conversion: { value: 1 },
    },
    slice(ranges) {
      dataSliceCalls.push(ranges);
      return new Float32Array([1, 10, 100, 2, 20, 200]);
    },
  };
  const timestamps = {
    shape: [6],
    attrs: {
      unit: { value: "seconds" },
    },
    slice(ranges) {
      timestampSliceCalls.push(ranges);
      return new Float64Array([0.625, 0.6258, 0.6266]);
    },
  };
  const series = {
    attrs: {
      neurodata_type: { value: "ElectricalSeries" },
    },
    keys() {
      return ["data", "timestamps"];
    },
    get(name) {
      if (name === "data") return data;
      if (name === "timestamps") return timestamps;
      return null;
    },
  };
  const groups = new Map([
    ["acquisition", makeContainer(["probe_lfp"])],
    ["acquisition/probe_lfp", series],
  ]);

  return {
    get(path) {
      return groups.get(path) ?? null;
    },
  };
}

function makeSeriesGroup({ neurodataType, dataShape, slicedData, rate }) {
  return {
    attrs: {
      neurodata_type: { value: neurodataType },
    },
    keys() {
      return ["data", "starting_time"];
    },
    get(name) {
      if (name === "data") {
        return {
          shape: dataShape,
          attrs: {
            unit: { value: "microvolts" },
            conversion: { value: 1 },
          },
          slice() {
            return slicedData;
          },
        };
      }
      if (name === "starting_time") {
        return {
          value: new Float64Array([0]),
          attrs: {
            rate: { value: new Float64Array([rate]) },
          },
        };
      }
      return null;
    },
  };
}

function makeContainer(keys) {
  return {
    keys() {
      return keys;
    },
  };
}
