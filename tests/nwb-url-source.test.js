import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeSourceFrame, makeSourceMeta } from "../src/data/frame-utils.js";
import {
  DANDI_ASSET_ID_PATTERN,
  NwbUrlSource,
  loadRemoteNwbPayload,
  probeRemoteNwbUrl,
  resolveRemoteNwbUrl,
} from "../src/data/nwb-url-source.js";

describe("remote NWB URL source", () => {
  it("resolves DANDI asset download URLs to the bare content URL used by range HEAD", async () => {
    const calls = [];
    const resolved = await resolveRemoteNwbUrl(
      "https://api.dandiarchive.org/api/assets/11646673-ac9a-42a0-b768-470af79ff4bc/download/?content_disposition=inline",
      {
        fetchImpl: async (url) => {
          calls.push(url);
          return jsonResponse({
            contentUrl: [
              "https://api.dandiarchive.org/api/assets/11646673-ac9a-42a0-b768-470af79ff4bc/download/",
              "https://dandiarchive.s3.amazonaws.com/blobs/a7f/c69/a7fc69c4-8fb2-4ee7-9e19-99222f31b8f4",
            ],
          });
        },
      },
    );

    assert.equal(resolved, "https://dandiarchive.s3.amazonaws.com/blobs/a7f/c69/a7fc69c4-8fb2-4ee7-9e19-99222f31b8f4");
    assert.deepEqual(calls, ["https://api.dandiarchive.org/api/assets/11646673-ac9a-42a0-b768-470af79ff4bc/"]);
  });

  it("probes remote range support before starting the worker-backed source", async () => {
    const calls = [];
    const probe = await probeRemoteNwbUrl("https://example.test/file.nwb", {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return headerResponse({
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-1023/71781159",
            "content-length": "1024",
          },
        });
      },
    });

    assert.equal(probe.supportsRange, true);
    assert.equal(probe.contentLength, 71781159);
    assert.equal(calls[0].options.headers.Range, "bytes=0-1023");
  });

  it("implements the source adapter surface through an injected remote payload loader", async () => {
    const meta = makeSourceMeta({
      sourceKind: "nwb-url",
      label: "Remote NWB excerpt",
      channelCount: 1,
      sampleRateHz: 1000,
      sampleCount: 2,
      sampleWindowMs: 2,
      units: "microvolts",
      sourceProvenance: {
        format: "NWB",
        source: "https://example.test/file.nwb",
        transport: "remote-range",
      },
    });
    const fixtureFrame = makeSourceFrame({
      sourceKind: "nwb-url",
      tStart: 0,
      tEnd: 2,
      channelCount: 1,
      sampleCount: 2,
      sampleRateHz: 1000,
      units: "microvolts",
      samples: new Float32Array([1, -1]),
      meta,
    });
    const source = new NwbUrlSource({
      src: "https://example.test/file.nwb",
      loop: false,
      probeUrl: async () => ({ supportsRange: true, contentLength: 4096 }),
      loadPayload: async () => ({ meta, frames: [fixtureFrame] }),
    });

    const frames = [];
    const statuses = [];
    await source.start(
      (frame) => frames.push(frame),
      (status) => statuses.push(status.message),
    );
    source.stop();

    assert.equal(source.meta(), meta);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].sourceKind, "nwb-url");
    assert.deepEqual(Array.from(frames[0].samples), [1, -1]);
    assert(statuses.some((message) => message.includes("Probing remote NWB URL")));
    assert(statuses.some((message) => message.includes("Remote NWB source is running")));
  });

  it("matches DANDI asset identifiers in supported URL shapes", () => {
    assert.equal(
      "https://api.dandiarchive.org/api/assets/11646673-ac9a-42a0-b768-470af79ff4bc/download/".match(DANDI_ASSET_ID_PATTERN)?.[1],
      "11646673-ac9a-42a0-b768-470af79ff4bc",
    );
  });

  it("forwards worker progress while loading remote payloads", async () => {
    const progress = [];
    const payload = {
      meta: makeSourceMeta({ sourceKind: "nwb-url", label: "Remote NWB excerpt" }),
      frames: [],
    };

    const loaded = await loadRemoteNwbPayload("https://example.test/file.nwb", {
      WorkerCtor: class FakeWorker {
        postMessage(message) {
          queueMicrotask(() => {
            this.onmessage({ data: { id: message.id, progress: { level: "info", message: "Loading h5wasm worker runtime." } } });
            this.onmessage({ data: { id: message.id, payload } });
          });
        }

        terminate() {}
      },
      onProgress: (status) => progress.push(status.message),
      timeoutMs: 1000,
      workerUrl: "fake-worker.js",
    });

    assert.equal(loaded, payload);
    assert.deepEqual(progress, ["Loading h5wasm worker runtime."]);
  });
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

function headerResponse({ status, headers }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  };
}
