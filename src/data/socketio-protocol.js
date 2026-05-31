export const SOCKET_IO_WEBSOCKET_URL =
  "wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket";

export function isEngineOpenPacket(packet) {
  return typeof packet === "string" && packet.startsWith("0{");
}

export function isNamespaceConnectedPacket(packet) {
  return typeof packet === "string" && packet.startsWith("40");
}

export function isPingPacket(packet) {
  return packet === "2";
}

export function isLiveDataPlaceholder(packet) {
  return typeof packet === "string" && packet.startsWith('451-["livedata"');
}

export function makeMeaSelectionPacket(zeroBasedMeaIndex) {
  if (
    !Number.isInteger(zeroBasedMeaIndex) ||
    zeroBasedMeaIndex < 0 ||
    zeroBasedMeaIndex > 3
  ) {
    throw new RangeError(`MEA index must be 0..3, got ${zeroBasedMeaIndex}`);
  }

  return `42["meaid",${zeroBasedMeaIndex}]`;
}
