import { SAMPLE_COUNT, SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js?v=20260601-perf";
import {
  copyChannelGroupToSamples,
  createLogicalLayout,
  makeSourceFrame,
  makeSourceMeta,
} from "./frame-utils.js?v=20260601-perf";
import { CHANNEL_COUNT, CHANNELS_PER_MEA } from "../mapping.js?v=20260601-perf";

export class DemoSource {
  constructor() {
    this.timer = null;
    this.phase = 0;
    this.random = mulberry32(0x5123ab);
    this.stopped = true;
    this.lastMeta = makeSourceMeta({
      sourceKind: "demo",
      label: "Deterministic in-browser demo",
      layout: createLogicalLayout(),
    });
  }

  meta() {
    return this.lastMeta;
  }

  start(onFrame, onStatus) {
    this.stop();
    this.stopped = false;
    onStatus?.({ level: "ok", message: "Synthetic demo source is running in-browser." });

    const emit = () => {
      if (this.stopped) return;
      this.phase += 1;
      const tEnd = Date.now();
      const samples = new Float32Array(CHANNEL_COUNT * SAMPLE_COUNT);
      const availableChannels = new Uint8Array(CHANNEL_COUNT).fill(1);

      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        copyChannelGroupToSamples({
          target: samples,
          source: makeDemoGroup(groupIndex + 1, this.phase, this.random),
          groupIndex,
          groupSize: CHANNELS_PER_MEA,
        });
      }

      onFrame(makeSourceFrame({
        sourceKind: "demo",
        tStart: tEnd - SAMPLE_WINDOW_MS,
        tEnd,
        channelCount: CHANNEL_COUNT,
        sampleCount: SAMPLE_COUNT,
        sampleRateHz: SAMPLE_RATE_HZ,
        units: this.lastMeta.units,
        samples,
        availableChannels,
        meta: this.lastMeta,
      }));
    };

    emit();
    this.timer = setInterval(emit, SAMPLE_WINDOW_MS);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = null;
  }
}

function makeDemoGroup(groupId, phase, random) {
  const data = new Float32Array(32 * SAMPLE_COUNT);
  const burstCenter = (phase * 257 + groupId * 431) % SAMPLE_COUNT;
  const activeBiochip = (phase + groupId) % 4;

  for (let channel = 0; channel < 32; channel += 1) {
    const channelOffset = channel * SAMPLE_COUNT;
    const chip = Math.floor(channel / 8);
    const channelGain = chip === activeBiochip ? 1.5 : 0.7;
    const baseNoise = 3 + groupId * 0.6 + (channel % 4) * 0.35;

    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      data[channelOffset + sample] = gaussian(random) * baseNoise;
    }

    if ((channel + phase + groupId) % 5 === 0 || chip === activeBiochip) {
      for (let pulse = 0; pulse < 3; pulse += 1) {
        const center = (burstCenter + pulse * 180 + channel * 13) % SAMPLE_COUNT;
        drawThresholdWaveform(data, channelOffset, center, channelGain * (45 + random() * 80));
      }
    }
  }

  return data;
}

function drawThresholdWaveform(data, channelOffset, center, amplitude) {
  const shape = [-0.1, -0.35, -0.8, -1, -0.6, 0.35, 0.18, 0.05];
  for (let i = 0; i < shape.length; i += 1) {
    const sample = center + i - 3;
    if (sample >= 0 && sample < SAMPLE_COUNT) {
      data[channelOffset + sample] += shape[i] * amplitude;
    }
  }
}

function gaussian(random) {
  return random() + random() + random() + random() - 2;
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
