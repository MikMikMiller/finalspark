import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isEngineOpenPacket,
  isLiveDataPlaceholder,
  isNamespaceConnectedPacket,
  isPingPacket,
  makeMeaSelectionPacket,
} from "../src/data/socketio-protocol.js";

describe("minimal Socket.IO protocol helpers", () => {
  it("recognizes Engine.IO and Socket.IO control packets", () => {
    assert.equal(isEngineOpenPacket('0{"sid":"abc"}'), true);
    assert.equal(isNamespaceConnectedPacket('40{"sid":"def"}'), true);
    assert.equal(isPingPacket("2"), true);
    assert.equal(isLiveDataPlaceholder('451-["livedata",{"buffer":{"_placeholder":true,"num":0}}]'), true);
  });

  it("formats zero-based MEA selection packets", () => {
    assert.equal(makeMeaSelectionPacket(0), '42["meaid",0]');
    assert.equal(makeMeaSelectionPacket(3), '42["meaid",3]');
    assert.throws(() => makeMeaSelectionPacket(4), /MEA index/i);
  });
});
