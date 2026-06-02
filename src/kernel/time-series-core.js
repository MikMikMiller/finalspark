export class TimeSeriesCore {
  constructor({ windowSeconds = 12 } = {}) {
    this.windowMs = sanitizeWindowSeconds(windowSeconds) * 1000;
    this.buffer = [];
  }

  setWindowSeconds(windowSeconds) {
    this.windowMs = sanitizeWindowSeconds(windowSeconds) * 1000;
    this.trim();
  }

  pushFrame(frame) {
    validateFrame(frame);
    this.buffer.push(frame);
    this.trim();
    return frame;
  }

  latestFrame() {
    return this.buffer[this.buffer.length - 1] ?? null;
  }

  frames() {
    return this.buffer.slice();
  }

  clear() {
    this.buffer = [];
  }

  trim() {
    const latest = this.latestFrame();
    if (!latest) return;
    const cutoff = latest.tEnd - this.windowMs;
    this.buffer = this.buffer.filter((frame) => frame.tEnd >= cutoff);
  }
}

function validateFrame(frame) {
  if (!frame || !(frame.samples instanceof Float32Array)) {
    throw new TypeError("core frames must contain Float32Array samples");
  }
  if (!Number.isInteger(frame.channelCount) || frame.channelCount <= 0) {
    throw new RangeError("core frames must contain a positive channelCount");
  }
  if (!Number.isInteger(frame.sampleCount) || frame.sampleCount <= 0) {
    throw new RangeError("core frames must contain a positive sampleCount");
  }
  if (frame.samples.length !== frame.channelCount * frame.sampleCount) {
    throw new RangeError("core frame sample length does not match its dimensions");
  }
}

function sanitizeWindowSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 12;
  return Math.min(120, Math.max(1, seconds));
}
