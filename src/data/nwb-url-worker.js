/* global h5wasm */

let currentRequestId = null;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.type !== "load") return;

  try {
    currentRequestId = message.id;
    const payload = await loadRemoteNwbPayloadInWorker(message);
    self.postMessage({ id: message.id, payload }, collectTransferables(payload));
  } catch (error) {
    self.postMessage({ id: message.id, error: error?.message ?? String(error) });
  } finally {
    currentRequestId = null;
  }
};

async function loadRemoteNwbPayloadInWorker({
  src,
  codecUrl,
  frameSampleCount,
  h5wasmIifeUrl,
  maxDurationSeconds,
}) {
  if (!src) throw new Error("Remote NWB URL is required.");
  if (!codecUrl) throw new Error("NWB codec URL is required.");
  if (!h5wasmIifeUrl) throw new Error("h5wasm worker URL is required.");

  postProgress("Loading h5wasm worker runtime.");
  if (!self.h5wasm) {
    self.importScripts(h5wasmIifeUrl);
  }
  const h5 = self.h5wasm;
  const { FS } = await h5.ready;
  postProgress("Opening remote NWB lazy file.");
  const root = `/nwb-url-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const fileName = "remote.nwb";
  const filePath = `${root}/${fileName}`;
  const restoreRangeHeaders = forceAcceptRangesHeader();
  FS.mkdir(root);

  try {
    FS.createLazyFile(root, fileName, src, true, false);

    const file = new h5.File(filePath, "r");
    try {
      postProgress("Reading remote NWB excerpt.");
      const { readNwbPayload } = await import(codecUrl);
      return readNwbPayload(file, {
        frameSampleCount,
        maxDurationSeconds,
        sourceKind: "nwb-url",
        sourceProvenance: {
          source: src,
          transport: "remote-range",
        },
      });
    } finally {
      file.close();
      try {
        FS.unlink(filePath);
      } catch {
        // The lazy file cache is best-effort cleanup after HDF5 closes the handle.
      }
    }
  } finally {
    restoreRangeHeaders();
    try {
      FS.rmdir(root);
    } catch {
      // The lazy file cache is best-effort cleanup after HDF5 closes the handle.
    }
  }
}

function postProgress(message) {
  if (!currentRequestId) return;
  self.postMessage({ id: currentRequestId, progress: { level: "info", message } });
}

function forceAcceptRangesHeader() {
  const prototype = self.XMLHttpRequest?.prototype;
  if (!prototype?.getResponseHeader) return () => {};
  const original = prototype.getResponseHeader;
  prototype.getResponseHeader = function getResponseHeader(name) {
    const value = original.call(this, name);
    if (!value && String(name).toLowerCase() === "accept-ranges") return "bytes";
    return value;
  };
  return () => {
    if (prototype.getResponseHeader !== original) prototype.getResponseHeader = original;
  };
}

function collectTransferables(payload) {
  const transferables = [];
  for (const frame of payload.frames ?? []) {
    if (frame.samples?.buffer) transferables.push(frame.samples.buffer);
    if (frame.availableChannels?.buffer) transferables.push(frame.availableChannels.buffer);
  }
  return transferables;
}
