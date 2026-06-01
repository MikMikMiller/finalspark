import {
  DEFAULT_RANGE_UV,
  DEFAULT_THRESHOLD_UV,
  MAX_RASTER_EVENTS,
  RASTER_WINDOW_MS,
  RANGES_UV,
  SAMPLE_RATE_HZ,
  SAMPLE_WINDOW_MS,
  SOURCE_LABELS,
  TIMELINE_POINTS,
} from "./config.js?v=20260601-perf";
import { DemoSource } from "./data/demo-source.js?v=20260601-perf";
import { LiveSource } from "./data/live-source.js?v=20260601-perf";
import { ReplaySource } from "./data/replay-source.js?v=20260601-perf";
import { channelTraceFromFrame } from "./data/frame-utils.js?v=20260601-perf";
import { channelsForMea, formatChannelLabel, mapChannel } from "./mapping.js?v=20260601-perf";
import { computeCenterOfActivity, computeFiringRates, computePopulationActivity, splitCountsByMea } from "./metrics.js?v=20260601-perf";
import { countSpikesByChannel, detectFrameCrossings, summarizeNoiseBand } from "./spike-detection.js?v=20260601-perf";
import { renderCenterOfActivity } from "./render/center-of-activity.js?v=20260601-perf";
import { renderHeatmap } from "./render/heatmap.js?v=20260601-perf";
import { renderRaster } from "./render/raster.js?v=20260601-perf";
import { renderSignalExplainer } from "./render/signal-explainer.js?v=20260601-perf";
import { renderTimeline } from "./render/timeline.js?v=20260601-perf";
import { parseSteppedNumberParam } from "./url-state.js?v=20260601-perf";

const SOURCE_FACTORIES = {
  live: () => new LiveSource(),
  replay: () => new ReplaySource(),
  demo: () => new DemoSource(),
};

const SOURCE_NAMES = new Set(Object.keys(SOURCE_FACTORIES));

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export class App {
  constructor(root = document) {
    this.root = root;
    this.source = null;
    this.sourceName = "live";
    this.frame = null;
    this.rates = new Float32Array(128);
    this.counts = new Uint16Array(128);
    this.heatmapScaleHz = 20;
    this.centers = Array.from({ length: 4 }, () => ({ active: false, x: null, y: null, totalSpikes: 0 }));
    this.rasterEvents = [];
    this.timeline = [];
    this.lastStatus = [];
    this.thresholdUv = DEFAULT_THRESHOLD_UV;
    this.rangeUv = DEFAULT_RANGE_UV;
    this.useAbsoluteIndex = false;
    this.selectedTraceChannel = 0;
    this.paused = false;
    this.lastFramePerfMs = null;
    this.freshnessTimer = null;

    this.nodes = {
      sourceButtons: Array.from(root.querySelectorAll("[data-source]")),
      controlDrawer: root.querySelector(".control-drawer"),
      controlSummary: root.querySelector("#controlSummary"),
      threshold: root.querySelector("#threshold"),
      thresholdValue: root.querySelector("#thresholdValue"),
      range: root.querySelector("#range"),
      absoluteIndex: root.querySelector("#absoluteIndex"),
      pause: root.querySelector("#pause"),
      clear: root.querySelector("#clear"),
      statusBox: root.querySelector(".status-box"),
      statusHeadline: root.querySelector("#statusHeadline"),
      freshnessMeta: root.querySelector("#freshnessMeta"),
      sourceStatus: root.querySelector("#sourceStatus"),
      sampleMeta: root.querySelector("#sampleMeta"),
      populationRate: root.querySelector("#populationRate"),
      activeChannels: root.querySelector("#activeChannels"),
      totalCrossings: root.querySelector("#totalCrossings"),
      sampleRate: root.querySelector("#sampleRate"),
      meaStats: root.querySelector("#meaStats"),
      heatmapLegendMax: root.querySelector("#heatmapLegendMax"),
      raster: root.querySelector("#rasterCanvas"),
      heatmap: root.querySelector("#heatmapCanvas"),
      timeline: root.querySelector("#timelineCanvas"),
      center: root.querySelector("#centerCanvas"),
      signal: root.querySelector("#signalCanvas"),
      rasterMeta: root.querySelector("#rasterMeta"),
      heatmapMeta: root.querySelector("#heatmapMeta"),
      timelineMeta: root.querySelector("#timelineMeta"),
      centerMeta: root.querySelector("#centerMeta"),
      signalMeta: root.querySelector("#signalMeta"),
      noiseSummary: root.querySelector("#noiseSummary"),
      rasterSummary: root.querySelector("#rasterSummary"),
      heatmapSummary: root.querySelector("#heatmapSummary"),
      timelineSummary: root.querySelector("#timelineSummary"),
      centerSummary: root.querySelector("#centerSummary"),
      signalSummary: root.querySelector("#signalSummary"),
      mappingProbe: root.querySelector("#mappingProbe"),
    };
  }

  async start() {
    this.bindControls();
    this.populateRange();
    this.applyUrlState();
    this.syncControlNodes();
    this.syncControlDrawerForViewport();
    this.updateStaticMeta();
    this.freshnessTimer = window.setInterval(() => this.updateFreshness(), 1000);
    await this.setSource(this.sourceName);
    this.render();
    window.addEventListener("resize", () => {
      this.render();
      this.syncControlDrawerForViewport({ preserveUserChoice: true });
    });
  }

  bindControls() {
    for (const button of this.nodes.sourceButtons) {
      button.addEventListener("click", () => this.setSource(button.dataset.source));
    }

    this.nodes.threshold.addEventListener("input", () => {
      this.thresholdUv = Number(this.nodes.threshold.value);
      this.syncControlNodes();
      this.updateUrlState();
      if (this.frame) this.consumeFrame(this.frame, { keepHistory: false });
      else {
        this.updateChartSummaries();
        this.render();
      }
    });

    this.nodes.range.addEventListener("change", () => {
      this.rangeUv = Number(this.nodes.range.value);
      this.syncControlNodes();
      this.updateUrlState();
      this.updateChartSummaries();
      this.render();
    });

    this.nodes.absoluteIndex.addEventListener("change", () => {
      this.useAbsoluteIndex = this.nodes.absoluteIndex.checked;
      this.syncControlNodes();
      this.updateUrlState();
      this.updateChartSummaries();
      this.render();
    });

    this.nodes.pause.addEventListener("click", () => {
      this.paused = !this.paused;
      this.nodes.pause.textContent = this.paused ? "Resume" : "Pause";
    });

    this.nodes.clear.addEventListener("click", () => {
      this.rasterEvents = [];
      this.timeline = [];
      this.updateChartSummaries();
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
  }

  applyUrlState() {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    if (source && SOURCE_NAMES.has(source)) this.sourceName = source;

    this.thresholdUv = parseSteppedNumberParam(params, "threshold", {
      fallback: DEFAULT_THRESHOLD_UV,
      min: 10,
      max: 500,
      step: 5,
    });

    const range = Number(params.get("range"));
    if (RANGES_UV.includes(range)) this.rangeUv = range;

    const labels = params.get("labels");
    if (labels === "absolute") this.useAbsoluteIndex = true;
    if (labels === "local") this.useAbsoluteIndex = false;
  }

  syncControlNodes() {
    this.nodes.threshold.value = String(this.thresholdUv);
    this.nodes.thresholdValue.textContent = `${this.thresholdUv} uV`;
    this.nodes.range.value = String(this.rangeUv);
    this.nodes.absoluteIndex.checked = this.useAbsoluteIndex;
    this.nodes.controlSummary.textContent =
      `${this.thresholdUv} uV | +/-${this.rangeUv} uV | ${this.useAbsoluteIndex ? "Absolute labels" : "Local labels"}`;
  }

  syncControlDrawerForViewport({ preserveUserChoice = false } = {}) {
    if (!this.nodes.controlDrawer) return;
    const shouldCollapse = window.matchMedia("(max-width: 600px)").matches;
    if (shouldCollapse && !preserveUserChoice) this.nodes.controlDrawer.open = false;
    if (!shouldCollapse) this.nodes.controlDrawer.open = true;
  }

  updateStaticMeta() {
    this.nodes.sampleRate.textContent = `${SAMPLE_RATE_HZ.toFixed(1)} Hz`;
    const probe = mapChannel(37);
    this.nodes.mappingProbe.textContent =
      `Mapping check: absolute 37 = MEA ${probe.meaId}, local ${probe.localIndex}, biochip ${probe.biochipIndex}, electrode ${probe.electrodeInBiochip}.`;
    this.updateChartSummaries();
  }

  async setSource(sourceName) {
    if (!SOURCE_FACTORIES[sourceName]) return;
    this.source?.stop();
    this.sourceName = sourceName;
    this.source = SOURCE_FACTORIES[sourceName]();
    this.frame = null;
    this.lastFramePerfMs = null;
    this.lastStatus = [];
    this.setActiveSourceButton();
    this.updateUrlState();
    this.updateFreshness();
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
    const latest = this.lastStatus[0];
    this.nodes.statusHeadline.textContent = latest?.message ?? "Starting";
    this.nodes.statusBox.dataset.level = latest?.level ?? "info";
    this.nodes.sourceStatus.textContent = this.lastStatus
      .map((entry) => `${TIME_FORMATTER.format(entry.at)} - ${entry.message}`)
      .join("\n");
  }

  consumeFrame(frame, { keepHistory = true } = {}) {
    this.frame = frame;
    this.lastFramePerfMs = performance.now();
    const crossings = detectFrameCrossings(frame.meas, {
      thresholdUv: this.thresholdUv,
      sampleRateHz: frame.sampleRateHz,
      refractoryMs: 2,
    });
    this.counts = countSpikesByChannel(crossings);
    this.rates = computeFiringRates(this.counts, frame.sampleWindowMs);
    const frameMaxRate = Math.max(20, ...this.rates);
    this.heatmapScaleHz = Math.max(frameMaxRate, this.heatmapScaleHz * 0.96);
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
      if (this.rasterEvents.length > MAX_RASTER_EVENTS) {
        this.rasterEvents = this.rasterEvents.slice(-MAX_RASTER_EVENTS);
      }

      const population = computePopulationActivity(this.counts, frame.sampleWindowMs);
      this.timeline.push({ timestamp: frame.timestamp, ...population });
      this.timeline = this.timeline.slice(-TIMELINE_POINTS);
    }

    this.selectedTraceChannel = findMostActiveChannel(this.counts);
    this.updateStats();
    this.updateFreshness(computePopulationActivity(this.counts, frame.sampleWindowMs));
    this.render();
  }

  updateStats() {
    const population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS);
    setSampleBadges(
      this.nodes.sampleMeta,
      this.frame
        ? [
            SOURCE_LABELS[this.sourceName],
            `${this.frame.meas.length}/4 MEAs`,
            TIME_FORMATTER.format(this.frame.timestamp),
          ]
        : ["Waiting"],
    );
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
      card.innerHTML = `<strong>MEA ${meaId}</strong><span>${total}</span><small>${active}/32 active</small>`;
      this.nodes.meaStats.append(card);
    }

    const trace = this.frame ? channelTraceFromFrame(this.frame, this.selectedTraceChannel) : null;
    if (trace) {
      const channel = mapChannel(this.selectedTraceChannel);
      const noise = summarizeNoiseBand(trace);
      this.nodes.noiseSummary.textContent =
        `Probe electrode ${formatChannelLabel(channel, this.useAbsoluteIndex)} on MEA ${channel.meaId}: center ${noise.centerUv} uV, noise floor ${noise.noiseFloorUv} uV.`;
    }
    this.updateChartSummaries(population);
  }

  updateChartSummaries(population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS)) {
    const totalRasterEvents = this.rasterEvents.length;
    this.nodes.rasterMeta.textContent = totalRasterEvents
      ? `${totalRasterEvents} crossings | ${(RASTER_WINDOW_MS / 1000).toFixed(0)} s`
      : `${(RASTER_WINDOW_MS / 1000).toFixed(0)} s window`;
    this.nodes.rasterSummary.textContent = totalRasterEvents
      ? `${totalRasterEvents} crossings are visible in the last ${(RASTER_WINDOW_MS / 1000).toFixed(0)} seconds.`
      : "Waiting for threshold crossings.";

    const maxRate = Math.max(0, ...this.rates);
    this.nodes.heatmapLegendMax.textContent = `${this.heatmapScaleHz.toFixed(1)} Hz`;
    this.nodes.heatmapMeta.textContent = maxRate > 0
      ? `Peak ${maxRate.toFixed(1)} Hz | Scale 0-${this.heatmapScaleHz.toFixed(1)}`
      : `Scale 0-${this.heatmapScaleHz.toFixed(1)} Hz`;
    this.nodes.heatmapSummary.textContent = maxRate > 0
      ? `Current heatmap peak is ${maxRate.toFixed(1)} Hz; color scale is stabilized at ${this.heatmapScaleHz.toFixed(1)} Hz.`
      : "Waiting for firing-rate data.";

    const latestTimeline = this.timeline[this.timeline.length - 1];
    this.nodes.timelineMeta.textContent = latestTimeline
      ? `${latestTimeline.populationRateHz.toFixed(1)} Hz | ${latestTimeline.activeChannels} active`
      : "Waiting";
    this.nodes.timelineSummary.textContent = latestTimeline
      ? `Latest timeline point: ${latestTimeline.totalSpikes} crossings, ${latestTimeline.activeChannels} active electrodes, ${latestTimeline.populationRateHz.toFixed(2)} Hz.`
      : "Waiting for timeline data.";

    const activeCenters = this.centers.filter((center) => center.active);
    this.nodes.centerMeta.textContent = `${activeCenters.length}/4 active`;
    this.nodes.centerSummary.textContent = activeCenters.length
      ? `${activeCenters.length}/4 MEA centers are active in the current window.`
      : "Waiting for center-of-activity data.";

    if (!this.frame) {
      this.nodes.signalMeta.textContent = `+/-${this.thresholdUv} uV`;
      this.nodes.signalSummary.textContent = "Waiting for probe-channel signal data.";
      return;
    }
    const channel = mapChannel(this.selectedTraceChannel);
    this.nodes.signalMeta.textContent = `+/-${this.thresholdUv} uV | ${formatChannelLabel(channel, this.useAbsoluteIndex)}`;
    this.nodes.signalSummary.textContent =
      `Signal trace is following ${formatChannelLabel(channel, this.useAbsoluteIndex)} on MEA ${channel.meaId} at +/-${this.rangeUv} uV.`;
  }

  updateFreshness(population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS)) {
    if (!this.frame || this.lastFramePerfMs === null) {
      this.nodes.freshnessMeta.textContent = "Waiting for frame";
      return;
    }
    const ageSeconds = Math.max(0, (performance.now() - this.lastFramePerfMs) / 1000);
    const ageLabel = ageSeconds < 9.95 ? `${ageSeconds.toFixed(1)}s ago` : `${Math.round(ageSeconds)}s ago`;
    this.nodes.freshnessMeta.textContent =
      `Last frame ${ageLabel} | ${this.frame.meas.length}/4 MEAs | ${population.activeChannels} active`;
  }

  updateUrlState() {
    const params = new URLSearchParams(window.location.search);
    params.set("source", this.sourceName);
    params.set("threshold", String(this.thresholdUv));
    params.set("range", String(this.rangeUv));
    params.set("labels", this.useAbsoluteIndex ? "absolute" : "local");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  render() {
    const nowMs = performance.now();
    renderRaster(this.nodes.raster, this.rasterEvents, {
      nowMs,
      windowMs: RASTER_WINDOW_MS,
      useAbsoluteIndex: this.useAbsoluteIndex,
    });
    renderHeatmap(this.nodes.heatmap, this.rates, {
      useAbsoluteIndex: this.useAbsoluteIndex,
      scaleMaxHz: this.heatmapScaleHz,
    });
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

function setSampleBadges(container, labels) {
  container.replaceChildren(
    ...labels.map((label) => {
      const badge = document.createElement("span");
      badge.className = "sample-badge";
      badge.textContent = label;
      return badge;
    }),
  );
}
