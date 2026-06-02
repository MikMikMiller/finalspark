import { LIVE_ENDPOINTS, SAMPLE_RATE_HZ, SAMPLE_WINDOW_MS } from "../config.js?v=20260601-perf";
import { CHANNEL_COUNT, CHANNELS_PER_MEA } from "../mapping.js?v=20260601-perf";
import {
  isEngineOpenPacket,
  isNamespaceConnectedPacket,
  isPingPacket,
  makeMeaSelectionPacket,
} from "./socketio-protocol.js?v=20260601-perf";
import {
  copyChannelGroupToSamples,
  createLogicalLayout,
  makeSourceFrame,
  makeSourceMeta,
} from "./frame-utils.js?v=20260601-perf";

export class LiveSource {
  constructor({ endpoints = LIVE_ENDPOINTS, meaId = null } = {}) {
    this.endpoints = endpoints;
    this.meaId = normalizeMeaId(meaId);
    this.sockets = [];
    this.latest = new Map();
    this.stopped = true;
    this.lastMeta = makeSourceMeta({
      sourceKind: "live",
      label: this.meaId ? `Public live stream, MEA ${this.meaId}` : "Public live stream",
      layout: createLogicalLayout(),
      sourceProvenance: {
        publicStreamOnly: true,
        transport: "Socket.IO websocket, EIO=4",
      },
    });
  }

  meta() {
    return this.lastMeta;
  }

  start(onFrame, onStatus) {
    this.stop();
    this.stopped = false;
    this.latest.clear();
    const meaIndexes = this.meaId ? [this.meaId - 1] : [0, 1, 2, 3];
    onStatus?.({
      level: "info",
      message: this.meaId ? `Opening public stream socket for MEA ${this.meaId}.` : "Opening four public stream sockets.",
    });

    for (const meaIndex of meaIndexes) {
      const socket = new LiveMeaSocket({
        meaIndex,
        endpoints: this.endpoints,
        onSample: (sample) => {
          this.latest.set(sample.meaId, sample);
          onFrame(this.makeFrame());
        },
        onStatus,
      });
      this.sockets.push(socket);
      socket.connect();
    }
  }

  stop() {
    this.stopped = true;
    for (const socket of this.sockets) {
      socket.stop();
    }
    this.sockets = [];
  }

  makeFrame() {
    const tEnd = Date.now();
    const samples = new Float32Array(CHANNEL_COUNT * 4096);
    const availableChannels = new Uint8Array(CHANNEL_COUNT);

    for (const sample of this.latest.values()) {
      const groupIndex = sample.meaId - 1;
      copyChannelGroupToSamples({
        target: samples,
        source: sample.data,
        groupIndex,
        groupSize: CHANNELS_PER_MEA,
      });
      availableChannels.fill(1, groupIndex * CHANNELS_PER_MEA, (groupIndex + 1) * CHANNELS_PER_MEA);
    }

    return makeSourceFrame({
      sourceKind: "live",
      tStart: tEnd - SAMPLE_WINDOW_MS,
      tEnd,
      channelCount: CHANNEL_COUNT,
      sampleCount: 4096,
      sampleRateHz: SAMPLE_RATE_HZ,
      units: this.lastMeta.units,
      samples,
      availableChannels,
      meta: this.lastMeta,
    });
  }
}

function normalizeMeaId(meaId) {
  if (meaId === null || meaId === undefined || meaId === "" || meaId === "all") return null;
  const value = Number(meaId);
  if (!Number.isInteger(value) || value < 1 || value > 4) return null;
  return value;
}

class LiveMeaSocket {
  constructor({ meaIndex, endpoints, onSample, onStatus }) {
    this.meaIndex = meaIndex;
    this.meaId = meaIndex + 1;
    this.endpoints = endpoints;
    this.endpointIndex = 0;
    this.onSample = onSample;
    this.onStatus = onStatus;
    this.ws = null;
    this.stopped = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.namespaceReady = false;
    this.engineReady = false;
  }

  connect() {
    if (this.stopped) return;

    this.namespaceReady = false;
    this.engineReady = false;
    const endpoint = this.endpoints[this.endpointIndex % this.endpoints.length];
    this.onStatus?.({ level: "info", message: `MEA ${this.meaId}: connecting.` });

    try {
      this.ws = new WebSocket(endpoint);
      this.ws.binaryType = "arraybuffer";
    } catch (error) {
      this.scheduleReconnect(`MEA ${this.meaId}: ${error.message}`);
      return;
    }

    this.ws.addEventListener("message", (event) => this.handleMessage(event.data));
    this.ws.addEventListener("open", (event) => {
      if (this.stopped) {
        event.currentTarget.close();
        return;
      }
      this.onStatus?.({ level: "info", message: `MEA ${this.meaId}: socket open.` });
    });
    this.ws.addEventListener("close", () => {
      if (!this.stopped) {
        this.scheduleReconnect(`MEA ${this.meaId}: stream closed.`);
      }
    });
    this.ws.addEventListener("error", () => {
      if (!this.stopped) {
        this.onStatus?.({ level: "warn", message: `MEA ${this.meaId}: socket error.` });
      }
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      if (this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.addEventListener("open", (event) => event.currentTarget.close(), { once: true });
      } else {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  handleMessage(data) {
    if (this.stopped) return;

    if (typeof data === "string") {
      this.handleTextPacket(data);
      return;
    }

    if (data instanceof ArrayBuffer) {
      this.handleBinaryPacket(data);
      return;
    }

    if (data instanceof Blob) {
      data.arrayBuffer().then((buffer) => this.handleBinaryPacket(buffer));
    }
  }

  handleTextPacket(packet) {
    if (isEngineOpenPacket(packet) && !this.engineReady) {
      this.engineReady = true;
      this.ws?.send("40");
      return;
    }

    if (isNamespaceConnectedPacket(packet) && !this.namespaceReady) {
      this.namespaceReady = true;
      this.ws?.send(makeMeaSelectionPacket(this.meaIndex));
      return;
    }

    if (isPingPacket(packet)) {
      this.ws?.send("3");
    }
  }

  handleBinaryPacket(buffer) {
    if (buffer.byteLength !== 32 * 4096 * 4) {
      this.onStatus?.({
        level: "warn",
        message: `MEA ${this.meaId}: ignored ${buffer.byteLength} byte frame.`,
      });
      return;
    }

    this.reconnectAttempt = 0;
    this.onSample({
      meaId: this.meaId,
      data: new Float32Array(buffer.slice(0)),
    });
  }

  scheduleReconnect(reason) {
    clearTimeout(this.reconnectTimer);
    this.endpointIndex += 1;
    const delay = Math.min(30000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
    this.onStatus?.({ level: "warn", message: `${reason} Reconnecting in ${delay} ms.` });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
