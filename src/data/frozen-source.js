import { FROZEN_FIXTURE_URL } from "../config.js?v=20260601-perf";
import { cloneSourceFrame, makeSourceMeta } from "./frame-utils.js?v=20260601-perf";
import { normalizeFrozenPayload } from "./frozen-codec.js?v=20260601-perf";

export class FrozenSource {
  constructor({ src = FROZEN_FIXTURE_URL, loop = true, positionMs = 0 } = {}) {
    this.src = src || FROZEN_FIXTURE_URL;
    this.loop = loop;
    this.initialPositionMs = Math.max(0, Number(positionMs) || 0);
    this.timer = null;
    this.payload = null;
    this.index = 0;
    this.stopped = true;
    this.startedAt = 0;
    this.lastMeta = makeSourceMeta({
      sourceKind: "frozen",
      label: "Frozen capture",
    });
  }

  meta() {
    return this.payload?.meta ?? this.lastMeta;
  }

  async start(onFrame, onStatus) {
    this.stop();
    this.stopped = false;
    this.index = 0;
    onStatus?.({ level: "info", message: "Loading frozen source fixture." });

    const response = await fetch(this.src, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Frozen source failed to load: ${response.status}`);
    }

    this.payload = normalizeFrozenPayload(await response.json());
    this.lastMeta = this.payload.meta;
    this.startedAt = Date.now();
    if (this.initialPositionMs > 0) this.seek(this.initialPositionMs);
    this.emit(onFrame, onStatus);
    onStatus?.({ level: "ok", message: "Frozen source is running locally." });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  seek(timeMs) {
    if (!this.payload) return false;
    const target = Math.max(0, Number(timeMs) || 0);
    const nextIndex = this.payload.frames.findIndex((frame) => frame.tEnd >= target);
    this.index = nextIndex === -1 ? this.payload.frames.length - 1 : nextIndex;
    this.startedAt = Date.now() - target;
    return true;
  }

  emit(onFrame, onStatus) {
    if (this.stopped || !this.payload) return;
    const baseFrame = this.payload.frames[this.index];
    if (!baseFrame) {
      if (this.loop) {
        this.index = 0;
        this.startedAt = Date.now();
        this.emit(onFrame, onStatus);
      } else {
        onStatus?.({ level: "ok", message: "Frozen source reached the end." });
      }
      return;
    }

    const tStart = Date.now() - this.startedAt;
    const tEnd = tStart + baseFrame.sampleWindowMs;
    onFrame(cloneSourceFrame(baseFrame, { tStart, tEnd, meta: this.lastMeta, timestamp: new Date() }));
    this.index += 1;

    if (this.index >= this.payload.frames.length && this.loop) {
      this.index = 0;
      this.startedAt = Date.now();
    }

    this.timer = setTimeout(() => this.emit(onFrame, onStatus), baseFrame.sampleWindowMs);
  }
}
