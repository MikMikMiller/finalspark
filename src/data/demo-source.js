import { SAMPLE_COUNT, SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js?v=20260601-perf";
import { makeFrame } from "./frame-utils.js?v=20260601-perf";

export class DemoSource {
  constructor() {
    this.timer = null;
    this.phase = 0;
    this.random = mulberry32(0x5123ab);
  }

  start(onFrame, onStatus) {
    this.stop();
    onStatus?.({ level: "ok", message: "Synthetic demo source is running in-browser." });

    const emit = () => {
      this.phase += 1;
      onFrame(
        makeFrame({
          source: "demo",
          timestamp: new Date(),
          sampleRateHz: SAMPLE_RATE_HZ,
          sampleWindowMs: SAMPLE_WINDOW_MS,
          meas: [1, 2, 3, 4].map((meaId) => ({
            meaId,
            data: makeDemoMea(meaId, this.phase, this.random),
          })),
        }),
      );
    };

    emit();
    this.timer = setInterval(emit, SAMPLE_WINDOW_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}

function makeDemoMea(meaId, phase, random) {
  const data = new Float32Array(32 * SAMPLE_COUNT);
  const burstCenter = (phase * 257 + meaId * 431) % SAMPLE_COUNT;
  const activeBiochip = (phase + meaId) % 4;

  for (let channel = 0; channel < 32; channel += 1) {
    const channelOffset = channel * SAMPLE_COUNT;
    const chip = Math.floor(channel / 8);
    const channelGain = chip === activeBiochip ? 1.5 : 0.7;
    const baseNoise = 3 + meaId * 0.6 + (channel % 4) * 0.35;

    for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
      data[channelOffset + sample] = gaussian(random) * baseNoise;
    }

    if ((channel + phase + meaId) % 5 === 0 || chip === activeBiochip) {
      for (let pulse = 0; pulse < 3; pulse += 1) {
        const center = (burstCenter + pulse * 180 + channel * 13) % SAMPLE_COUNT;
        drawSpikeWaveform(data, channelOffset, center, channelGain * (45 + random() * 80));
      }
    }
  }

  return data;
}

function drawSpikeWaveform(data, channelOffset, center, amplitude) {
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
