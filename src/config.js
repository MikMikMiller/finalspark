export const SAMPLE_COUNT = 4096;
export const SAMPLE_WINDOW_MS = 1092.3;
export const SAMPLE_RATE_HZ = SAMPLE_COUNT / (SAMPLE_WINDOW_MS / 1000);
export const DEFAULT_THRESHOLD_UV = 50;
export const DEFAULT_RANGE_UV = 100;
export const RANGES_UV = [50, 100, 200, 500, 1000, 2000];
export const RASTER_WINDOW_MS = 12000;
export const MAX_RASTER_EVENTS = 12000;
export const TIMELINE_POINTS = 90;
export const FROZEN_FIXTURE_URL = "data/replay-sample.json";
export const LIVE_ENDPOINTS = [
  "wss://livemeaservice.finalspark.com/socket.io/?EIO=4&transport=websocket",
  "wss://livemeaservice2.alpvision.com/socket.io/?EIO=4&transport=websocket",
];

export const SOURCE_LABELS = {
  live: "Live",
  frozen: "Frozen",
  demo: "Demo",
};
