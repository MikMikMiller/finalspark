import { NWB_REMOTE_URL, SAMPLE_COUNT } from "../config.js?v=20260602-nwb-url-default";
import { cloneSourceFrame, makeSourceMeta } from "./frame-utils.js?v=20260601-perf";

export const DANDI_ASSET_ID_PATTERN =
  /(?:^|\/)assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

const H5WASM_IIFE_URL = "https://cdn.jsdelivr.net/npm/h5wasm@0.10.2/dist/iife/h5wasm.js";
const DEFAULT_MAX_DURATION_SECONDS = 0.25;

export class NwbUrlSource {
  constructor({
    src = NWB_REMOTE_URL,
    loop = true,
    positionMs = 0,
    maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
    probeUrl = probeRemoteNwbUrl,
    loadPayload = loadRemoteNwbPayload,
    resolveUrl = resolveRemoteNwbUrl,
    h5wasmIifeUrl = H5WASM_IIFE_URL,
    workerUrl = new URL("./nwb-url-worker.js?v=20260602-nwb-url-range", import.meta.url).href,
  } = {}) {
    this.src = src || NWB_REMOTE_URL;
    this.loop = loop;
    this.initialPositionMs = Math.max(0, Number(positionMs) || 0);
    this.maxDurationSeconds = Math.max(0.1, Number(maxDurationSeconds) || DEFAULT_MAX_DURATION_SECONDS);
    this.probeUrl = probeUrl;
    this.loadPayload = loadPayload;
    this.resolveUrl = resolveUrl;
    this.h5wasmIifeUrl = h5wasmIifeUrl;
    this.workerUrl = workerUrl;
    this.timer = null;
    this.payload = null;
    this.index = 0;
    this.stopped = true;
    this.startedAt = 0;
    this.lastMeta = makeSourceMeta({
      sourceKind: "nwb-url",
      label: "Remote NWB excerpt",
      sourceProvenance: {
        format: "NWB",
        transport: "remote-range",
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
    onStatus?.({ level: "info", message: "Probing remote NWB URL." });

    const resolvedSrc = await this.resolveUrl(this.src);
    const probe = await this.probeUrl(resolvedSrc);
    if (!probe.supportsRange) {
      throw new Error("Remote NWB URL does not support byte-range reads.");
    }

    onStatus?.({ level: "info", message: "Opening remote NWB excerpt with byte-range transport." });
    this.payload = await this.loadPayload(resolvedSrc, {
      frameSampleCount: SAMPLE_COUNT,
      h5wasmIifeUrl: this.h5wasmIifeUrl,
      maxDurationSeconds: this.maxDurationSeconds,
      onProgress: onStatus,
      workerUrl: this.workerUrl,
    });
    this.lastMeta = this.payload.meta;
    this.startedAt = Date.now();
    if (this.initialPositionMs > 0) this.seek(this.initialPositionMs);
    this.emit(onFrame, onStatus);
    onStatus?.({ level: "ok", message: "Remote NWB source is running from byte ranges." });
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
        onStatus?.({ level: "ok", message: "Remote NWB source reached the end." });
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

export async function resolveRemoteNwbUrl(src = NWB_REMOTE_URL, { fetchImpl = fetch } = {}) {
  const url = String(src || NWB_REMOTE_URL);
  const assetId = url.match(DANDI_ASSET_ID_PATTERN)?.[1];
  if (!assetId) return url;

  const metadataUrl = `https://api.dandiarchive.org/api/assets/${assetId}/`;
  const response = await fetchImpl(metadataUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`DANDI asset metadata failed to load: ${response.status}`);
  }
  const metadata = await response.json();
  return selectRangeReadableContentUrl(metadata.contentUrl) ?? url;
}

export async function probeRemoteNwbUrl(src, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(src, {
    method: "GET",
    headers: {
      Range: "bytes=0-1023",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Remote NWB range probe failed: ${response.status}`);
  }

  const contentRange = response.headers.get("content-range");
  const acceptRanges = response.headers.get("accept-ranges");
  const contentLength = parseContentLength(contentRange) ?? parsePositiveInteger(response.headers.get("content-length"));
  return {
    supportsRange: response.status === 206 || Boolean(contentRange) || acceptRanges === "bytes",
    contentLength,
    contentRange,
  };
}

export function loadRemoteNwbPayload(src, {
  frameSampleCount = SAMPLE_COUNT,
  h5wasmIifeUrl = H5WASM_IIFE_URL,
  maxDurationSeconds = DEFAULT_MAX_DURATION_SECONDS,
  onProgress = null,
  timeoutMs = 120000,
  WorkerCtor = globalThis.Worker,
  workerUrl = new URL("./nwb-url-worker.js?v=20260602-nwb-url-range", import.meta.url).href,
} = {}) {
  if (typeof WorkerCtor !== "function") {
    return Promise.reject(new Error("Remote NWB range reads require Web Worker support."));
  }

  return new Promise((resolve, reject) => {
    const worker = new WorkerCtor(workerUrl, { name: "fs-kernel-nwb-url" });
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("Remote NWB worker timed out."));
    }, timeoutMs);

    worker.onmessage = (event) => {
      if (event.data?.id !== requestId) return;
      if (event.data.progress) {
        onProgress?.(event.data.progress);
        return;
      }
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }
      resolve(event.data.payload);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || "Remote NWB worker failed."));
    };

    worker.postMessage({
      id: requestId,
      type: "load",
      src,
      codecUrl: new URL("./nwb-codec.js?v=20260602-nwb-url-default", import.meta.url).href,
      frameSampleCount,
      h5wasmIifeUrl,
      maxDurationSeconds,
    });
  });
}

function selectRangeReadableContentUrl(urls) {
  if (!Array.isArray(urls)) return null;
  return (
    urls.find((url) => typeof url === "string" && url.includes("dandiarchive.s3.amazonaws.com")) ??
    urls.find((url) => typeof url === "string" && !url.includes("/download/")) ??
    null
  );
}

function parseContentLength(contentRange) {
  if (!contentRange) return null;
  const match = String(contentRange).match(/\/(\d+)$/);
  return parsePositiveInteger(match?.[1]);
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
