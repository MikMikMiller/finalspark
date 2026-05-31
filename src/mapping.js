export const MEA_COUNT = 4;
export const CHANNELS_PER_MEA = 32;
export const BIOCHIPS_PER_MEA = 4;
export const ELECTRODES_PER_BIOCHIP = 8;
export const CHANNEL_COUNT = MEA_COUNT * CHANNELS_PER_MEA;
export const MEA_GRID_COLUMNS = 8;
export const MEA_GRID_ROWS = 4;

export function mapChannel(absoluteIndex) {
  if (!Number.isInteger(absoluteIndex) || absoluteIndex < 0 || absoluteIndex >= CHANNEL_COUNT) {
    throw new RangeError(`Invalid absolute channel index: ${absoluteIndex}`);
  }

  const meaIndex = Math.floor(absoluteIndex / CHANNELS_PER_MEA);
  const localIndex = absoluteIndex % CHANNELS_PER_MEA;
  const biochipIndex = Math.floor(localIndex / ELECTRODES_PER_BIOCHIP);
  const electrodeInBiochip = localIndex % ELECTRODES_PER_BIOCHIP;
  const chipColumn = biochipIndex % 2;
  const chipRow = Math.floor(biochipIndex / 2);
  const electrodeColumn = electrodeInBiochip % 4;
  const electrodeRow = Math.floor(electrodeInBiochip / 4);

  return {
    absoluteIndex,
    meaId: meaIndex + 1,
    meaIndex,
    localIndex,
    biochipIndex,
    electrodeInBiochip,
    x: chipColumn * 4 + electrodeColumn,
    y: chipRow * 2 + electrodeRow,
  };
}

export function channelsForMea(meaId) {
  if (!Number.isInteger(meaId) || meaId < 1 || meaId > MEA_COUNT) {
    throw new RangeError(`Invalid MEA id: ${meaId}`);
  }

  const start = (meaId - 1) * CHANNELS_PER_MEA;
  return Array.from({ length: CHANNELS_PER_MEA }, (_, offset) => mapChannel(start + offset));
}

export function electrodeGridForMea(meaId) {
  const rows = Array.from({ length: MEA_GRID_ROWS }, () => Array(MEA_GRID_COLUMNS).fill(null));
  for (const channel of channelsForMea(meaId)) {
    rows[channel.y][channel.x] = channel;
  }
  return rows;
}

export function formatChannelLabel(channel, useAbsoluteIndex) {
  return String(useAbsoluteIndex ? channel.absoluteIndex : channel.localIndex).padStart(2, "0");
}
