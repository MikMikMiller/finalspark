import { meaAccent, prepareCanvas } from "./canvas.js";

export function renderRaster(canvas, events, { nowMs, windowMs, useAbsoluteIndex }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const left = 48;
  const right = 12;
  const top = 18;
  const bottom = 20;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const rowHeight = plotHeight / 128;

  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d8ddd7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#6b746d";

  for (let channel = 0; channel < 128; channel += 8) {
    const y = top + channel * rowHeight;
    ctx.strokeStyle = channel % 32 === 0 ? "#c5ccc5" : "#edf0ea";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();

    const label = useAbsoluteIndex ? channel : channel % 32;
    ctx.fillText(String(label).padStart(2, "0"), left - 8, y + rowHeight * 4);
  }

  for (const event of events) {
    const age = nowMs - event.absoluteTimeMs;
    if (age < 0 || age > windowMs) continue;
    const x = left + plotWidth * (1 - age / windowMs);
    const y = top + event.absoluteChannel * rowHeight + rowHeight / 2;
    const meaId = Math.floor(event.absoluteChannel / 32) + 1;

    ctx.fillStyle = meaAccent(meaId);
    ctx.globalAlpha = Math.max(0.25, 1 - age / windowMs);
    ctx.fillRect(x, y - Math.max(1, rowHeight * 0.4), 2, Math.max(2, rowHeight * 0.8));
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#2d342f";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(`${Math.round(windowMs / 1000)} s rolling raster`, left, height - 6);
}
