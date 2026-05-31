import {
  DEFAULT_RANGE_UV,
  DEFAULT_THRESHOLD_UV,
  RASTER_WINDOW_MS,
  RANGES_UV,
  SAMPLE_RATE_HZ,
  SAMPLE_WINDOW_MS,
  SOURCE_LABELS,
  TIMELINE_POINTS,
} from "./config.js";
import { DemoSource } from "./data/demo-source.js";
import { LiveSource } from "./data/live-source.js";
import { ReplaySource } from "./data/replay-source.js";
import { channelTraceFromFrame } from "./data/frame-utils.js";
import { channelsForMea, formatChannelLabel, mapChannel } from "./mapping.js";
import { computeCenterOfActivity, computeFiringRates, computePopulationActivity, splitCountsByMea } from "./metrics.js";
import { countSpikesByChannel, detectFrameCrossings, summarizeNoiseBand } from "./spike-detection.js";
import { renderCenterOfActivity } from "./render/center-of-activity.js";
import { renderHeatmap } from "./render/heatmap.js";
import { renderRaster } from "./render/raster.js";
import { renderSignalExplainer } from "./render/signal-explainer.js";
import { renderTimeline } from "./render/timeline.js";

const SOURCE_FACTORIES = {
  live: () => new LiveSource(),
  replay: () => new ReplaySource(),
  demo: () => new DemoSource(),
};

export class App {
  constructor(root = document) {
    this.root = root;
    this.source = null;
    this.sourceName = "live";
    this.frame = null;
    this.rates = new Float32Array(128);
    this.counts = new Uint16Array(128);
    this.centers = Array.from({ length: 4 }, () => ({ active: false, x: null, y: null, totalSpikes: 0 }));
    this.rasterEvents = [];
    this.timeline = [];
    this.lastStatus = [];
    this.thresholdUv = DEFAULT_THRESHOLD_UV;
    this.rangeUv = DEFAULT_RANGE_UV;
    this.useAbsoluteIndex = false;
    this.selectedTraceChannel = 0;
    this.paused = false;

    this.nodes = {
      sourceButtons: Array.from(root.querySelectorAll("[data-source]")),
      threshold: root.querySelector("#threshold"),
      thresholdValue: root.querySelector("#thresholdValue"),
      range: root.querySelector("#range"),
      absoluteIndex: root.querySelector("#absoluteIndex"),
      pause: root.querySelector("#pause"),
      clear: root.querySelector("#clear"),
      sourceStatus: root.querySelector("#sourceStatus"),
      sampleMeta: root.querySelector("#sampleMeta"),
      populationRate: root.querySelector("#populationRate"),
      activeChannels: root.querySelector("#activeChannels"),
      totalCrossings: root.querySelector("#totalCrossings"),
      sampleRate: root.querySelector("#sampleRate"),
      meaStats: root.querySelector("#meaStats"),
      raster: root.querySelector("#rasterCanvas"),
      heatmap: root.querySelector("#heatmapCanvas"),
      timeline: root.querySelector("#timelineCanvas"),
      center: root.querySelector("#centerCanvas"),
      signal: root.querySelector("#signalCanvas"),
      noiseSummary: root.querySelector("#noiseSummary"),
      mappingProbe: root.querySelector("#mappingProbe"),
    };
  }

  async start() {
    this.bindControls();
    this.populateRange();
    this.updateStaticMeta();
    await this.setSource(this.sourceName);
    this.render();
    window.addEventListener("resize", () => this.render());
  }

  bindControls() {
    for (const button of this.nodes.sourceButtons) {
      button.addEventListener("click", () => this.setSource(button.dataset.source));
    }

    this.nodes.threshold.addEventListener("input", () => {
      this.thresholdUv = Number(this.nodes.threshold.value);
      this.nodes.thresholdValue.textContent = `${this.thresholdUv} uV`;
      if (this.frame) this.consumeFrame(this.frame, { keepHistory: false });
    });

    this.nodes.range.addEventListener("change", () => {
      this.rangeUv = Number(this.nodes.range.value);
      this.render();
    });

    this.nodes.absoluteIndex.addEventListener("change", () => {
      this.useAbsoluteIndex = this.nodes.absoluteIndex.checked;
      this.render();
    });

    this.nodes.pause.addEventListener("click", () => {
      this.paused = !this.paused;
      this.nodes.pause.textContent = this.paused ? "Resume" : "Pause";
    });

    this.nodes.clear.addEventListener("click", () => {
      this.rasterEvents = [];
      this.timeline = [];
      this.render();
    });
  }

  populateRange() {
    for (const value of RANGES_UV) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `+/-${value} uV`;
      option.selected = value === DEFAULT_RANGE_UV;
      this.nodes.range.append(option);
    }
    this.nodes.threshold.value = String(DEFAULT_THRESHOLD_UV);
    this.nodes.thresholdValue.textContent = `${DEFAULT_THRESHOLD_UV} uV`;
  }

  updateStaticMeta() {
    this.nodes.sampleRate.textContent = `${SAMPLE_RATE_HZ.toFixed(1)} Hz`;
    const probe = mapChannel(37);
    this.nodes.mappingProbe.textContent =
      `Mapping check: absolute 37 = MEA ${probe.meaId}, local ${probe.localIndex}, biochip ${probe.biochipIndex}, electrode ${probe.electrodeInBiochip}.`;
  }

  async setSource(sourceName) {
    if (!SOURCE_FACTORIES[sourceName]) return;
    this.source?.stop();
    this.sourceName = sourceName;
    this.source = SOURCE_FACTORIES[sourceName]();
    this.lastStatus = [];
    this.setActiveSourceButton();
    this.pushStatus({ level: "info", message: `Starting ${SOURCE_LABELS[sourceName]} source.` });

    try {
      await this.source.start(
        (frame) => {
          if (!this.paused) this.consumeFrame(frame);
        },
        (status) => this.pushStatus(status),
      );
    } catch (error) {
      this.pushStatus({ level: "error", message: error.message });
      if (sourceName !== "demo") {
        await this.setSource("demo");
      }
    }
  }

  setActiveSourceButton() {
    for (const button of this.nodes.sourceButtons) {
      button.classList.toggle("is-active", button.dataset.source === this.sourceName);
      button.setAttribute("aria-pressed", String(button.dataset.source === this.sourceName));
    }
  }

  pushStatus(status) {
    this.lastStatus.unshift({ ...status, at: new Date() });
    this.lastStatus = this.lastStatus.slice(0, 4);
    this.nodes.sourceStatus.textContent = this.lastStatus
      .map((entry) => `${entry.at.toLocaleTimeString()} - ${entry.message}`)
      .join("\n");
    this.nodes.sourceStatus.dataset.level = this.lastStatus[0]?.level ?? "info";
  }

  consumeFrame(frame, { keepHistory = true } = {}) {
    this.frame = frame;
    const crossings = detectFrameCrossings(frame.meas, {
      thresholdUv: this.thresholdUv,
      sampleRateHz: frame.sampleRateHz,
      refractoryMs: 2,
    });
    this.counts = countSpikesByChannel(crossings);
    this.rates = computeFiringRates(this.counts, frame.sampleWindowMs);
    const countsByMea = splitCountsByMea(this.counts);
    this.centers = countsByMea.map((localCounts, index) =>
      computeCenterOfActivity(localCounts, channelsForMea(index + 1)),
    );

    const nowMs = performance.now();
    if (keepHistory) {
      for (const crossing of crossings) {
        this.rasterEvents.push({
          ...crossing,
          absoluteTimeMs: nowMs - frame.sampleWindowMs + crossing.timeMs,
        });
      }
      this.rasterEvents = this.rasterEvents.filter((event) => nowMs - event.absoluteTimeMs <= RASTER_WINDOW_MS);

      const population = computePopulationActivity(this.counts, frame.sampleWindowMs);
      this.timeline.push({ timestamp: frame.timestamp, ...population });
      this.timeline = this.timeline.slice(-TIMELINE_POINTS);
    }

    this.selectedTraceChannel = findMostActiveChannel(this.counts);
    this.updateStats();
    this.render();
  }

  updateStats() {
    const population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS);
    this.nodes.sampleMeta.textContent = this.frame
      ? `${SOURCE_LABELS[this.sourceName]} | ${this.frame.meas.length}/4 MEAs | ${this.frame.timestamp.toLocaleTimeString()}`
      : "Waiting for data";
    this.nodes.populationRate.textContent = `${population.populationRateHz.toFixed(2)} Hz`;
    this.nodes.activeChannels.textContent = String(population.activeChannels);
    this.nodes.totalCrossings.textContent = String(population.totalSpikes);

    const countsByMea = splitCountsByMea(this.counts);
    this.nodes.meaStats.innerHTML = "";
    for (let meaId = 1; meaId <= 4; meaId += 1) {
      const localCounts = countsByMea[meaId - 1];
      const total = localCounts.reduce((sum, count) => sum + count, 0);
      const active = localCounts.filter((count) => count > 0).length;
      const card = document.createElement("div");
      card.className = "mea-stat";
      card.innerHTML = `<strong>MEA ${meaId}</strong><span>${total} crossings</span><small>${active}/32 active electrodes</small>`;
      this.nodes.meaStats.append(card);
    }

    const trace = this.frame ? channelTraceFromFrame(this.frame, this.selectedTraceChannel) : null;
    if (trace) {
      const channel = mapChannel(this.selectedTraceChannel);
      const noise = summarizeNoiseBand(trace);
      this.nodes.noiseSummary.textContent =
        `Probe electrode ${formatChannelLabel(channel, this.useAbsoluteIndex)} on MEA ${channel.meaId}: center ${noise.centerUv} uV, noise floor ${noise.noiseFloorUv} uV.`;
    }
  }

  render() {
    const nowMs = performance.now();
    renderRaster(this.nodes.raster, this.rasterEvents, {
      nowMs,
      windowMs: RASTER_WINDOW_MS,
      useAbsoluteIndex: this.useAbsoluteIndex,
    });
    renderHeatmap(this.nodes.heatmap, this.rates, { useAbsoluteIndex: this.useAbsoluteIndex });
    renderTimeline(this.nodes.timeline, this.timeline);
    renderCenterOfActivity(this.nodes.center, this.centers);
    renderSignalExplainer(
      this.nodes.signal,
      this.frame ? channelTraceFromFrame(this.frame, this.selectedTraceChannel) : null,
      { thresholdUv: this.thresholdUv, rangeUv: this.rangeUv },
    );
  }
}

function findMostActiveChannel(counts) {
  let bestIndex = 0;
  let bestCount = -1;
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] > bestCount) {
      bestCount = counts[index];
      bestIndex = index;
    }
  }
  return bestIndex;
}
