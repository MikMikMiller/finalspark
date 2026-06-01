import { prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderSignalExplainer(canvas, trace, { thresholdUv, rangeUv }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const left = 34;
  const right = 12;
  const top = 18;
  const bottom = 12;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const centerY = top + plotHeight / 2;
  const scale = plotHeight / 2 / rangeUv;

  ctx.fillStyle = "#eaf6ff";
  const band = Math.min(plotHeight / 2, thresholdUv * scale);
  ctx.fillRect(left, centerY - band, plotWidth, band * 2);

  ctx.strokeStyle = "#c64b2d";
  ctx.setLineDash([4, 4]);
  for (const sign of [-1, 1]) {
    const y = clamp(centerY - sign * thresholdUv * scale, top, top + plotHeight);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (trace) {
    ctx.beginPath();
    const step = Math.max(1, Math.floor(trace.length / plotWidth));
    let x = left;
    for (let i = 0; i < trace.length; i += step) {
      const y = centerY - clamp(trace[i], -rangeUv, rangeUv) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += 1;
    }
    ctx.strokeStyle = "#202722";
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
