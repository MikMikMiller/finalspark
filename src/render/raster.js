import { meaAccent, prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderRaster(canvas, events, { nowMs, windowMs, useAbsoluteIndex }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const left = 68;
  const right = 12;
  const top = 12;
  const bottom = 12;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const rowHeight = plotHeight / 128;

  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#68717a";

  for (let meaId = 1; meaId <= 4; meaId += 1) {
    const channel = (meaId - 1) * 32;
    const y = top + channel * rowHeight;
    ctx.strokeStyle = "#cbd7e4";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = meaAccent(meaId);
    ctx.fillText(`MEA ${meaId}`, 10, y + rowHeight * 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#68717a";
  }

  for (let channel = 0; channel < 128; channel += 8) {
    const y = top + channel * rowHeight;
    ctx.strokeStyle = channel % 32 === 0 ? "#cbd7e4" : "#edf2f7";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();

    const label = useAbsoluteIndex ? channel : channel % 32;
    ctx.fillText(String(label).padStart(2, "0"), left - 8, y + rowHeight * 4);
  }

  const drawableEvents = capDrawableEvents(events, Math.max(1400, Math.floor(width * 8)));
  for (const event of drawableEvents) {
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
}

function capDrawableEvents(events, maxEvents) {
  if (events.length <= maxEvents) return events;
  const stride = Math.ceil(events.length / maxEvents);
  const capped = [];
  for (let index = events.length - 1; index >= 0 && capped.length < maxEvents; index -= stride) {
    capped.push(events[index]);
  }
  capped.reverse();
  return capped;
}
