import { NWB_FIXTURE_URL } from "../config.js?v=20260602-nwb";
import { cloneSourceFrame, makeSourceMeta } from "./frame-utils.js?v=20260601-perf";
import { readNwbPayload } from "./nwb-codec.js?v=20260602-nwb";

const H5WASM_ESM_URL = "https://cdn.jsdelivr.net/npm/h5wasm@0.10.2/dist/esm/hdf5_hl.js";

export class NwbSource {
  constructor({
    src = NWB_FIXTURE_URL,
    loop = true,
    positionMs = 0,
    loadPayload = null,
    h5wasmUrl = H5WASM_ESM_URL,
  } = {}) {
    this.src = src || NWB_FIXTURE_URL;
    this.loop = loop;
    this.initialPositionMs = Math.max(0, Number(positionMs) || 0);
    this.loadPayload = loadPayload;
    this.h5wasmUrl = h5wasmUrl;
    this.timer = null;
    this.payload = null;
    this.index = 0;
    this.stopped = true;
    this.startedAt = 0;
    this.lastMeta = makeSourceMeta({
      sourceKind: "nwb",
      label: "NWB excerpt",
      sourceProvenance: {
        format: "NWB",
      },
    });
  }

  meta() {
    return this.payload?.meta ?? this.lastMeta;
  }

  async start(onFrame, onStatus) {
    this.stop();
    this.stopped = false;
    this.index = 0;
    onStatus?.({ level: "info", message: "Loading NWB source." });

    this.payload = this.loadPayload
      ? await this.loadPayload(this.src)
      : await loadNwbPayload(this.src, { h5wasmUrl: this.h5wasmUrl });
    this.lastMeta = this.payload.meta;
    this.startedAt = Date.now();
    if (this.initialPositionMs > 0) this.seek(this.initialPositionMs);
    this.emit(onFrame, onStatus);
    onStatus?.({ level: "ok", message: "NWB source is running locally." });
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
        onStatus?.({ level: "ok", message: "NWB source reached the end." });
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

async function loadNwbPayload(src, { h5wasmUrl }) {
  const bytes = await readSourceBytes(src);
  const h5wasmModule = await import(h5wasmUrl);
  const h5wasm = h5wasmModule.default ?? h5wasmModule;
  const { FS } = await h5wasm.ready;
  const fileName = `/nwb-source-${Date.now()}-${Math.random().toString(36).slice(2)}.nwb`;
  FS.writeFile(fileName, bytes);
  const file = new h5wasm.File(fileName, "r");
  try {
    return readNwbPayload(file, {
      sourceProvenance: {
        source: describeSource(src),
      },
    });
  } finally {
    file.close();
    try {
      FS.unlink(fileName);
    } catch {
      // Emscripten FS cleanup is best-effort after the HDF5 handle is closed.
    }
  }
}

async function readSourceBytes(src) {
  if (isFileLike(src)) {
    return new Uint8Array(await src.arrayBuffer());
  }

  const response = await fetch(src || NWB_FIXTURE_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`NWB source failed to load: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function isFileLike(value) {
  return value && typeof value.arrayBuffer === "function" && typeof value.name === "string";
}

function describeSource(src) {
  if (isFileLike(src)) return src.name;
  return String(src || NWB_FIXTURE_URL);
}
