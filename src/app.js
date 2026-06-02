import {
  DEFAULT_RANGE_UV,
  DEFAULT_THRESHOLD_UV,
  MAX_RASTER_EVENTS,
  RANGES_UV,
  RASTER_WINDOW_MS,
  SAMPLE_RATE_HZ,
  SAMPLE_WINDOW_MS,
  SOURCE_LABELS,
  TIMELINE_POINTS,
} from "./config.js?v=20260602-nwb";
import { DemoSource } from "./data/demo-source.js?v=20260601-perf";
import { FrozenSource } from "./data/frozen-source.js?v=20260601-perf";
import { LiveSource } from "./data/live-source.js?v=20260601-perf";
import { channelTraceFromFrame } from "./data/frame-utils.js?v=20260601-perf";
import { TimeSeriesCore } from "./kernel/time-series-core.js?v=20260601-perf";
import { channelsForMea, formatChannelLabel, mapChannel } from "./mapping.js?v=20260601-perf";
import { computeCenterOfActivity, computeCrossingRates, computePopulationActivity, splitCountsByLayout } from "./metrics.js?v=20260602-nwb";
import { countCrossingsByChannel, detectFrameCrossings, summarizeNoiseBand } from "./crossing-detection.js?v=20260601-perf";
import { renderCenterOfActivity } from "./render/center-of-activity.js?v=20260602-nwb";
import { renderHeatmap } from "./render/heatmap.js?v=20260602-nwb";
import { renderRaster } from "./render/raster.js?v=20260602-nwb";
import { renderSignalExplainer } from "./render/signal-explainer.js?v=20260601-perf";
import { renderTimeline } from "./render/timeline.js?v=20260601-perf";
import { parseSteppedNumberParam } from "./url-state.js?v=20260601-perf";

const DEFAULT_WINDOW_SECONDS = RASTER_WINDOW_MS / 1000;
const SOURCE_FACTORIES = {
  live: (options) => new LiveSource({ meaId: options.meaId }),
  frozen: (options) => new FrozenSource({ src: options.src, loop: options.loop, positionMs: options.positionMs }),
  nwb: async (options) => {
    const { NwbSource } = await import("./data/nwb-source.js?v=20260602-nwb");
    return new NwbSource({ src: options.src, loop: options.loop, positionMs: options.positionMs });
  },
  demo: () => new DemoSource(),
};
const SOURCE_ALIASES = {
  replay: "frozen",
};
const SOURCE_NAMES = new Set(Object.keys(SOURCE_FACTORIES));
const VIEW_NAMES = new Set(["overview", "mapping", "explain"]);
const WINDOW_SECONDS_OPTIONS = [6, 12, 30, 60];

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export class App {
  constructor(root = document, options = {}) {
    this.root = root;
    this.options = options;
    this.source = null;
    this.sourceName = normalizeSourceName(options.source) ?? "live";
    this.sourceInputs = {};
    if (options.src !== undefined && options.src !== null) this.sourceInputs[this.sourceName] = options.src;
    this.sourceSrc = typeof this.sourceInputs[this.sourceName] === "string" ? this.sourceInputs[this.sourceName] : null;
    this.meaId = options.meaId ?? options.meaID ?? null;
    this.initialPositionMs = Number(options.positionMs) || 0;
    this.viewName = normalizeViewName(options.view) ?? "overview";
    this.urlState = options.urlState !== false;
    this.windowSeconds = normalizeWindowSeconds(options.window ?? options.windowSeconds ?? DEFAULT_WINDOW_SECONDS) ?? DEFAULT_WINDOW_SECONDS;
    this.windowMs = this.windowSeconds * 1000;
    this.core = new TimeSeriesCore({ windowSeconds: this.windowSeconds });
    this.frame = null;
    this.rates = new Float32Array(128);
    this.counts = new Uint16Array(128);
    this.heatmapScaleHz = 20;
    this.centers = Array.from({ length: 4 }, () => ({ active: false, x: null, y: null, totalCrossings: 0 }));
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
    this.abortController = null;
    this.resizeObserver = null;
    this.started = false;

    this.nodes = {
      container: root.querySelector(".fs-kernel-root"),
      sourceButtons: Array.from(root.querySelectorAll("[data-source]")),
      viewButtons: Array.from(root.querySelectorAll("[data-view]")),
      viewPanels: Array.from(root.querySelectorAll("[data-view-panel]")),
      controlDrawer: root.querySelector(".control-drawer"),
      controlSummary: root.querySelector("#controlSummary"),
      threshold: root.querySelector("#threshold"),
      thresholdValue: root.querySelector("#thresholdValue"),
      range: root.querySelector("#range"),
      window: root.querySelector("#window"),
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
    if (this.started) this.stop();
    this.started = true;
    this.abortController = new AbortController();
    this.bindControls();
    this.populateRange();
    this.populateWindowOptions();
    this.applyUrlState();
    this.syncControlNodes();
    this.syncViewNodes();
    this.syncControlDrawerForViewport();
    this.updateStaticMeta();
    this.freshnessTimer = window.setInterval(() => this.updateFreshness(), 1000);
    this.observeResize();
    await this.setSource(this.sourceName);
    this.render();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.source?.stop();
    this.source = null;
    this.core.clear();
    clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
    this.abortController?.abort();
    this.abortController = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  bindControls() {
    const signal = this.abortController.signal;
    for (const button of this.nodes.sourceButtons) {
      button.addEventListener("click", () => this.setSource(button.dataset.source), { signal });
    }

    for (const button of this.nodes.viewButtons) {
      button.addEventListener("click", () => this.setView(button.dataset.view), { signal });
    }

    this.nodes.threshold?.addEventListener("input", () => {
      this.thresholdUv = Number(this.nodes.threshold.value);
      this.syncControlNodes();
      this.updateUrlState();
      if (this.frame) this.consumeFrame(this.frame, { keepHistory: false });
      else {
        this.updateChartSummaries();
        this.render();
      }
    }, { signal });

    this.nodes.range?.addEventListener("change", () => {
      this.rangeUv = Number(this.nodes.range.value);
      this.syncControlNodes();
      this.updateUrlState();
      this.updateChartSummaries();
      this.render();
    }, { signal });

    this.nodes.window?.addEventListener("change", () => {
      this.windowSeconds = normalizeWindowSeconds(this.nodes.window.value);
      this.windowMs = this.windowSeconds * 1000;
      this.core.setWindowSeconds(this.windowSeconds);
      this.rasterEvents = this.rasterEvents.filter((event) => performance.now() - event.absoluteTimeMs <= this.windowMs);
      this.syncControlNodes();
      this.updateUrlState();
      this.updateChartSummaries();
      this.render();
    }, { signal });

    this.nodes.absoluteIndex?.addEventListener("change", () => {
      this.useAbsoluteIndex = this.nodes.absoluteIndex.checked;
      this.syncControlNodes();
      this.updateUrlState();
      this.updateChartSummaries();
      this.render();
    }, { signal });

    this.nodes.pause?.addEventListener("click", () => {
      this.paused = !this.paused;
      this.nodes.pause.textContent = this.paused ? "Resume" : "Pause";
    }, { signal });

    this.nodes.clear?.addEventListener("click", () => {
      this.rasterEvents = [];
      this.timeline = [];
      this.core.clear();
      this.updateChartSummaries();
      this.render();
    }, { signal });
  }

  populateRange() {
    if (!this.nodes.range || this.nodes.range.children.length) return;
    for (const value of RANGES_UV) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `+/-${value} uV`;
      option.selected = value === DEFAULT_RANGE_UV;
      this.nodes.range.append(option);
    }
  }

  populateWindowOptions() {
    if (!this.nodes.window || this.nodes.window.children.length) return;
    for (const value of WINDOW_SECONDS_OPTIONS) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = `${value} s`;
      this.nodes.window.append(option);
    }
  }

  applyUrlState() {
    if (!this.urlState) return;
    const params = new URLSearchParams(window.location.search);
    const source = normalizeSourceName(params.get("source"));
    if (source) this.sourceName = source;

    const view = normalizeViewName(params.get("view"));
    if (view) this.viewName = view;

    const windowSeconds = normalizeWindowSeconds(params.get("window"));
    if (windowSeconds) {
      this.windowSeconds = windowSeconds;
      this.windowMs = windowSeconds * 1000;
      this.core.setWindowSeconds(windowSeconds);
    }

    const src = params.get("src");
    if (src) {
      this.sourceInputs[this.sourceName] = src;
      this.sourceSrc = src;
    }

    const position = Number(params.get("position"));
    if (Number.isFinite(position) && position >= 0) this.initialPositionMs = position;

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
    if (this.nodes.threshold) this.nodes.threshold.value = String(this.thresholdUv);
    if (this.nodes.thresholdValue) this.nodes.thresholdValue.textContent = `${this.thresholdUv} uV`;
    if (this.nodes.range) this.nodes.range.value = String(this.rangeUv);
    if (this.nodes.window) this.nodes.window.value = String(this.windowSeconds);
    if (this.nodes.absoluteIndex) this.nodes.absoluteIndex.checked = this.useAbsoluteIndex;
    if (this.nodes.controlSummary) {
      this.nodes.controlSummary.textContent =
        `${this.thresholdUv} uV | +/-${this.rangeUv} uV | ${this.windowSeconds}s | ${this.useAbsoluteIndex ? "Absolute labels" : "Local labels"}`;
    }
  }

  syncViewNodes() {
    for (const button of this.nodes.viewButtons) {
      button.classList.toggle("is-active", button.dataset.view === this.viewName);
      button.setAttribute("aria-pressed", String(button.dataset.view === this.viewName));
    }
    for (const panel of this.nodes.viewPanels) {
      const views = (panel.dataset.viewPanel ?? "").split(/\s+/);
      panel.hidden = !views.includes(this.viewName);
    }
  }

  syncControlDrawerForViewport({ preserveUserChoice = false } = {}) {
    if (!this.nodes.controlDrawer) return;
    const shouldCollapse = window.matchMedia("(max-width: 600px)").matches;
    if (shouldCollapse && !preserveUserChoice) this.nodes.controlDrawer.open = false;
    if (!shouldCollapse) this.nodes.controlDrawer.open = true;
  }

  observeResize() {
    const resizeTarget = this.nodes.container ?? this.root.host ?? document.documentElement;
    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => {
        this.render();
        this.syncControlDrawerForViewport({ preserveUserChoice: true });
      });
      this.resizeObserver.observe(resizeTarget);
      return;
    }

    window.addEventListener("resize", () => {
      this.render();
      this.syncControlDrawerForViewport({ preserveUserChoice: true });
    }, { signal: this.abortController.signal });
  }

  updateStaticMeta() {
    if (this.nodes.sampleRate) this.nodes.sampleRate.textContent = `${SAMPLE_RATE_HZ.toFixed(1)} Hz`;
    const probe = mapChannel(37);
    if (this.nodes.mappingProbe) {
      this.nodes.mappingProbe.textContent =
        `Mapping check: absolute 37 = MEA ${probe.meaId}, local ${probe.localIndex}, biochip ${probe.biochipIndex}, electrode ${probe.electrodeInBiochip}.`;
    }
    this.updateChartSummaries();
  }

  async setSource(sourceName) {
    const normalized = normalizeSourceName(sourceName);
    if (!normalized || !SOURCE_FACTORIES[normalized]) return;
    this.source?.stop();
    this.core.clear();
    this.sourceName = normalized;
    const sourceInput = this.sourceInputs[normalized];
    this.sourceSrc = typeof sourceInput === "string" ? sourceInput : null;
    this.source = await SOURCE_FACTORIES[normalized]({
      src: sourceInput || undefined,
      meaId: this.meaId,
      loop: this.options.loop ?? true,
      positionMs: this.initialPositionMs,
    });
    this.frame = null;
    this.lastFramePerfMs = null;
    this.lastStatus = [];
    this.rasterEvents = [];
    this.timeline = [];
    this.setActiveSourceButton();
    this.updateUrlState();
    this.updateFreshness();
    this.pushStatus({ level: "info", message: `Starting ${SOURCE_LABELS[normalized]} source.` });

    try {
      await this.source.start(
        (frame) => {
          if (!this.paused) {
            this.core.pushFrame(frame);
            this.consumeFrame(frame);
          }
        },
        (status) => this.pushStatus(status),
      );
    } catch (error) {
      this.pushStatus({ level: "error", message: error.message });
      if (normalized !== "demo") {
        await this.setSource("demo");
      }
    }
  }

  setView(viewName) {
    const normalized = normalizeViewName(viewName);
    if (!normalized) return;
    this.viewName = normalized;
    this.syncViewNodes();
    this.updateUrlState();
    this.render();
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
    if (this.nodes.statusHeadline) this.nodes.statusHeadline.textContent = latest?.message ?? "Starting";
    if (this.nodes.statusBox) this.nodes.statusBox.dataset.level = latest?.level ?? "info";
    if (this.nodes.sourceStatus) {
      this.nodes.sourceStatus.textContent = this.lastStatus
        .map((entry) => `${TIME_FORMATTER.format(entry.at)} - ${entry.message}`)
        .join("\n");
    }
  }

  consumeFrame(frame, { keepHistory = true } = {}) {
    this.frame = frame;
    this.lastFramePerfMs = performance.now();
    const crossings = detectFrameCrossings(frame, {
      thresholdUv: this.thresholdUv,
      sampleRateHz: frame.sampleRateHz,
      refractoryMs: 2,
    });
    this.counts = countCrossingsByChannel(crossings, frame.channelCount);
    this.rates = computeCrossingRates(this.counts, frame.sampleWindowMs);
    const frameMaxRate = Math.max(20, ...this.rates);
    this.heatmapScaleHz = Math.max(frameMaxRate, this.heatmapScaleHz * 0.96);
    this.centers = computeLayoutCenters(this.counts, frame);

    const nowMs = performance.now();
    if (keepHistory) {
      for (const crossing of crossings) {
        this.rasterEvents.push({
          ...crossing,
          absoluteTimeMs: nowMs - frame.sampleWindowMs + crossing.timeMs,
        });
      }
      this.rasterEvents = this.rasterEvents.filter((event) => nowMs - event.absoluteTimeMs <= this.windowMs);
      if (this.rasterEvents.length > MAX_RASTER_EVENTS) {
        this.rasterEvents = this.rasterEvents.slice(-MAX_RASTER_EVENTS);
      }

      const population = computePopulationActivity(this.counts, frame.sampleWindowMs);
      this.timeline.push({ timestamp: frame.timestamp, ...population });
      this.timeline = this.timeline.slice(-TIMELINE_POINTS);
    }

    this.selectedTraceChannel = findMostActiveChannel(this.counts, frame);
    this.updateStats();
    this.updateFreshness(computePopulationActivity(this.counts, frame.sampleWindowMs));
    if (this.sourceName === "frozen" || this.sourceName === "nwb") this.updateUrlState();
    this.render();
  }

  updateStats() {
    const population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS);
    setSampleBadges(
      this.nodes.sampleMeta,
      this.frame
        ? [
            SOURCE_LABELS[this.sourceName],
            `${countAvailableChannels(this.frame)}/${this.frame.channelCount} channels`,
            TIME_FORMATTER.format(this.frame.timestamp),
          ]
        : ["Waiting"],
    );
    if (this.nodes.populationRate) this.nodes.populationRate.textContent = `${population.populationRateHz.toFixed(2)} Hz`;
    if (this.nodes.activeChannels) this.nodes.activeChannels.textContent = String(population.activeChannels);
    if (this.nodes.totalCrossings) this.nodes.totalCrossings.textContent = String(population.totalCrossings);
    if (this.nodes.sampleRate) this.nodes.sampleRate.textContent = `${(this.frame?.sampleRateHz ?? SAMPLE_RATE_HZ).toFixed(1)} Hz`;

    if (this.nodes.meaStats) {
      const groups = splitCountsByLayout(this.counts, this.frame?.meta?.layout);
      this.nodes.meaStats.replaceChildren();
      for (const group of groups) {
        const total = group.counts.reduce((sum, count) => sum + count, 0);
        const active = group.counts.filter((count) => count > 0).length;
        const card = document.createElement("div");
        card.className = "mea-stat";
        card.innerHTML = `<strong>${escapeHtml(group.label)}</strong><span>${total}</span><small>${active}/${group.channelCount} active</small>`;
        this.nodes.meaStats.append(card);
      }
    }

    const trace = this.frame ? channelTraceFromFrame(this.frame, this.selectedTraceChannel) : null;
    if (trace && this.nodes.noiseSummary) {
      const noise = summarizeNoiseBand(trace);
      if (isMeaFrame(this.frame)) {
        const channel = mapChannel(this.selectedTraceChannel);
        this.nodes.noiseSummary.textContent =
          `Probe electrode ${formatChannelLabel(channel, this.useAbsoluteIndex)} on MEA ${channel.meaId}: center ${noise.centerUv} ${this.frame.units}, noise floor ${noise.noiseFloorUv} ${this.frame.units}.`;
      } else {
        this.nodes.noiseSummary.textContent =
          `Probe ${formatGenericChannelLabel(this.frame, this.selectedTraceChannel)}: center ${noise.centerUv} ${this.frame.units}, noise floor ${noise.noiseFloorUv} ${this.frame.units}.`;
      }
    }
    this.updateChartSummaries(population);
  }

  updateChartSummaries(population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS)) {
    const totalRasterEvents = this.rasterEvents.length;
    if (this.nodes.rasterMeta) {
      this.nodes.rasterMeta.textContent = totalRasterEvents
        ? `${totalRasterEvents} crossings | ${this.windowSeconds.toFixed(0)} s`
        : `${this.windowSeconds.toFixed(0)} s window`;
    }
    if (this.nodes.rasterSummary) {
      this.nodes.rasterSummary.textContent = totalRasterEvents
        ? `${totalRasterEvents} crossings are visible in the last ${this.windowSeconds.toFixed(0)} seconds.`
        : "Waiting for threshold crossings.";
    }

    const maxRate = Math.max(0, ...this.rates);
    if (this.nodes.heatmapLegendMax) this.nodes.heatmapLegendMax.textContent = `${this.heatmapScaleHz.toFixed(1)} Hz`;
    if (this.nodes.heatmapMeta) {
      this.nodes.heatmapMeta.textContent = maxRate > 0
        ? `Peak ${maxRate.toFixed(1)} Hz | Scale 0-${this.heatmapScaleHz.toFixed(1)}`
        : `Scale 0-${this.heatmapScaleHz.toFixed(1)} Hz`;
    }
    if (this.nodes.heatmapSummary) {
      this.nodes.heatmapSummary.textContent = maxRate > 0
        ? `Current heatmap peak is ${maxRate.toFixed(1)} Hz; color scale is stabilized at ${this.heatmapScaleHz.toFixed(1)} Hz.`
        : "Waiting for activity-rate data.";
    }

    const latestTimeline = this.timeline[this.timeline.length - 1];
    if (this.nodes.timelineMeta) {
      this.nodes.timelineMeta.textContent = latestTimeline
        ? `${latestTimeline.populationRateHz.toFixed(1)} Hz | ${latestTimeline.activeChannels} active`
        : "Waiting";
    }
    if (this.nodes.timelineSummary) {
      this.nodes.timelineSummary.textContent = latestTimeline
        ? `Latest timeline point: ${latestTimeline.totalCrossings} crossings, ${latestTimeline.activeChannels} active electrodes, ${latestTimeline.populationRateHz.toFixed(2)} Hz.`
        : "Waiting for timeline data.";
    }

    const activeCenters = this.centers.filter((center) => center.active);
    const centerCount = this.centers.length || 4;
    if (this.nodes.centerMeta) this.nodes.centerMeta.textContent = `${activeCenters.length}/${centerCount} active`;
    if (this.nodes.centerSummary) {
      this.nodes.centerSummary.textContent = activeCenters.length
        ? `${activeCenters.length}/${centerCount} layout groups are active in the current window.`
        : "Waiting for center-of-activity data.";
    }

    if (!this.frame) {
      if (this.nodes.signalMeta) this.nodes.signalMeta.textContent = `+/-${this.thresholdUv} uV`;
      if (this.nodes.signalSummary) this.nodes.signalSummary.textContent = "Waiting for probe-channel signal data.";
      return;
    }
    const channel = this.frame && isMeaFrame(this.frame) ? mapChannel(this.selectedTraceChannel) : null;
    if (this.nodes.signalMeta) {
      const label = channel
        ? formatChannelLabel(channel, this.useAbsoluteIndex)
        : formatGenericChannelLabel(this.frame, this.selectedTraceChannel);
      this.nodes.signalMeta.textContent = `+/-${this.thresholdUv} ${this.frame.units} | ${label}`;
    }
    if (this.nodes.signalSummary) {
      this.nodes.signalSummary.textContent = channel
        ? `Signal trace is following ${formatChannelLabel(channel, this.useAbsoluteIndex)} on MEA ${channel.meaId} at +/-${this.rangeUv} ${this.frame.units}.`
        : `Signal trace is following ${formatGenericChannelLabel(this.frame, this.selectedTraceChannel)} at +/-${this.rangeUv} ${this.frame.units}.`;
    }
  }

  updateFreshness(population = computePopulationActivity(this.counts, this.frame?.sampleWindowMs ?? SAMPLE_WINDOW_MS)) {
    if (!this.nodes.freshnessMeta) return;
    if (!this.frame || this.lastFramePerfMs === null) {
      this.nodes.freshnessMeta.textContent = "Waiting for frame";
      return;
    }
    const ageSeconds = Math.max(0, (performance.now() - this.lastFramePerfMs) / 1000);
    const ageLabel = ageSeconds < 9.95 ? `${ageSeconds.toFixed(1)}s ago` : `${Math.round(ageSeconds)}s ago`;
    this.nodes.freshnessMeta.textContent =
      `Last frame ${ageLabel} | ${countAvailableChannels(this.frame)}/${this.frame.channelCount} channels | ${population.activeChannels} active`;
  }

  updateUrlState() {
    if (!this.urlState) return;
    const params = new URLSearchParams(window.location.search);
    params.set("source", this.sourceName);
    params.set("view", this.viewName);
    params.set("window", String(this.windowSeconds));
    params.set("threshold", String(this.thresholdUv));
    params.set("range", String(this.rangeUv));
    params.set("labels", this.useAbsoluteIndex ? "absolute" : "local");
    if (this.sourceName === "frozen" || this.sourceName === "nwb") {
      if (this.sourceSrc) params.set("src", this.sourceSrc);
      if (this.frame) params.set("position", String(Math.max(0, Math.round(this.frame.tEnd))));
    } else {
      params.delete("src");
      params.delete("position");
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  render() {
    if (!this.nodes.raster) return;
    const nowMs = performance.now();
    renderRaster(this.nodes.raster, this.rasterEvents, {
      nowMs,
      windowMs: this.windowMs,
      useAbsoluteIndex: this.useAbsoluteIndex,
      channelCount: this.frame?.channelCount ?? 128,
      layout: this.frame?.meta?.layout ?? null,
    });
    renderHeatmap(this.nodes.heatmap, this.rates, {
      useAbsoluteIndex: this.useAbsoluteIndex,
      scaleMaxHz: this.heatmapScaleHz,
      layout: this.frame?.meta?.layout ?? null,
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

function normalizeSourceName(source) {
  if (!source) return null;
  const normalized = SOURCE_ALIASES[source] ?? source;
  return SOURCE_NAMES.has(normalized) ? normalized : null;
}

function normalizeViewName(view) {
  return VIEW_NAMES.has(view) ? view : null;
}

function normalizeWindowSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(120, Math.max(1, Math.round(seconds)));
}

function findMostActiveChannel(counts, frame) {
  let bestIndex = -1;
  let bestCount = -1;
  for (let index = 0; index < counts.length; index += 1) {
    if (frame?.availableChannels?.[index] === 0) continue;
    if (counts[index] > bestCount) {
      bestCount = counts[index];
      bestIndex = index;
    }
  }
  return bestIndex >= 0 ? bestIndex : 0;
}

function countAvailableChannels(frame) {
  if (!frame?.availableChannels) return frame?.channelCount ?? 0;
  return frame.availableChannels.reduce((sum, value) => sum + (value ? 1 : 0), 0);
}

function computeLayoutCenters(counts, frame) {
  const groups = splitCountsByLayout(counts, frame?.meta?.layout);
  if (isMeaFrame(frame)) {
    return groups.map((group, index) => ({
      ...computeCenterOfActivity(group.counts, channelsForMea(index + 1)),
      label: group.label,
      groupId: group.id,
      gridColumns: 8,
      gridRows: 4,
    }));
  }

  return groups.map((group) => {
    const grid = genericGridDimensions(group.channelCount);
    return {
      ...computeGenericCenterOfActivity(group.counts, grid),
      label: group.label,
      groupId: group.id,
      gridColumns: grid.columns,
      gridRows: grid.rows,
    };
  });
}

function computeGenericCenterOfActivity(counts, { columns, rows }) {
  let weightedX = 0;
  let weightedY = 0;
  let totalCrossings = 0;

  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index];
    if (count <= 0) continue;
    weightedX += (index % columns) * count;
    weightedY += Math.floor(index / columns) * count;
    totalCrossings += count;
  }

  if (totalCrossings === 0) {
    return {
      active: false,
      x: null,
      y: null,
      totalCrossings: 0,
    };
  }

  return {
    active: true,
    x: Math.round((weightedX / totalCrossings) * 1000) / 1000,
    y: Math.min(rows - 1, Math.round((weightedY / totalCrossings) * 1000) / 1000),
    totalCrossings,
  };
}

function genericGridDimensions(channelCount) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(channelCount)));
  return {
    columns,
    rows: Math.max(1, Math.ceil(channelCount / columns)),
  };
}

function isMeaFrame(frame) {
  const groups = frame?.meta?.layout?.groups;
  return frame?.channelCount === 128 &&
    Array.isArray(groups) &&
    groups.length === 4 &&
    groups.every((group, index) => group.startChannel === index * 32 && group.channelCount === 32);
}

function formatGenericChannelLabel(frame, channelIndex) {
  const groups = frame?.meta?.layout?.groups ?? [];
  const group = groups.find((candidate) =>
    channelIndex >= candidate.startChannel && channelIndex < candidate.startChannel + candidate.channelCount,
  );
  if (!group) return `Channel ${channelIndex}`;
  return `${group.label} ch ${channelIndex - group.startChannel}`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function setSampleBadges(container, labels) {
  if (!container) return;
  container.replaceChildren(
    ...labels.map((label) => {
      const badge = document.createElement("span");
      badge.className = "sample-badge";
      badge.textContent = label;
      return badge;
    }),
  );
}
