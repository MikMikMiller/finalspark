import { prepareCanvas } from "./canvas.js";

export function renderSignalExplainer(canvas, trace, { thresholdUv, rangeUv }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d8ddd7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const left = 34;
  const right = 12;
  const top = 22;
  const bottom = 22;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const centerY = top + plotHeight / 2;
  const scale = plotHeight / 2 / rangeUv;

  ctx.fillStyle = "#f1f4ee";
  const band = Math.min(plotHeight / 2, thresholdUv * scale);
  ctx.fillRect(left, centerY - band, plotWidth, band * 2);

  ctx.strokeStyle = "#c64b2d";
  ctx.setLineDash([4, 4]);
  for (const sign of [-1, 1]) {
    const y = centerY - sign * thresholdUv * scale;
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
    ctx.strokeStyle = "#26302a";
    ctx.lineWidth = 1.3;
    ctx.stroke();
  }

  ctx.fillStyle = "#2d342f";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(
    width < 520 ? "Signals vs noise" : "Signals vs noise: crossings outside the shaded band are counted",
    left,
    15,
  );
  ctx.fillStyle = "#66716b";
  ctx.fillText(`+/-${thresholdUv} uV threshold`, left, height - 7);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
