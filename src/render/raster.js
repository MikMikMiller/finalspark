import { meaAccent, prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderRaster(canvas, events, { nowMs, windowMs, useAbsoluteIndex, channelCount = 128, layout = null }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  const left = 68;
  const right = 12;
  const top = 12;
  const bottom = 12;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const rows = Math.max(1, channelCount);
  const rowHeight = plotHeight / rows;
  const groups = layoutGroups(layout, rows);

  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#68717a";

  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const channel = group.startChannel;
    const y = top + channel * rowHeight;
    ctx.strokeStyle = "#cbd7e4";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = meaAccent(group.id ?? index + 1);
    ctx.fillText(compactLabel(group.label), 10, y + Math.min(18, rowHeight * 2));
    ctx.textAlign = "right";
    ctx.fillStyle = "#68717a";
  }

  const tickStep = Math.max(1, Math.ceil(rows / 16));
  for (let channel = 0; channel < rows; channel += tickStep) {
    const y = top + channel * rowHeight;
    ctx.strokeStyle = groups.some((group) => group.startChannel === channel) ? "#cbd7e4" : "#edf2f7";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();

    const group = groups.find((candidate) =>
      channel >= candidate.startChannel && channel < candidate.startChannel + candidate.channelCount,
    );
    const label = useAbsoluteIndex || !group ? channel : channel - group.startChannel;
    ctx.fillText(String(label).padStart(2, "0"), left - 8, y + rowHeight * 4);
  }

  const drawableEvents = capDrawableEvents(events, Math.max(1400, Math.floor(width * 8)));
  for (const event of drawableEvents) {
    const age = nowMs - event.absoluteTimeMs;
    if (age < 0 || age > windowMs) continue;
    const x = left + plotWidth * (1 - age / windowMs);
    const y = top + event.absoluteChannel * rowHeight + rowHeight / 2;
    const group = groups.find((candidate) =>
      event.absoluteChannel >= candidate.startChannel &&
      event.absoluteChannel < candidate.startChannel + candidate.channelCount,
    );

    ctx.fillStyle = meaAccent(group?.id ?? 1);
    ctx.globalAlpha = Math.max(0.25, 1 - age / windowMs);
    ctx.fillRect(x, y - Math.max(1, rowHeight * 0.4), 2, Math.max(2, rowHeight * 0.8));
  }
  ctx.globalAlpha = 1;
}

function layoutGroups(layout, channelCount) {
  if (Array.isArray(layout?.groups) && layout.groups.length) return layout.groups;
  return [{ id: 1, label: "Channels", startChannel: 0, channelCount }];
}

function compactLabel(label) {
  const text = String(label ?? "Channels");
  return text.length > 10 ? `${text.slice(0, 9)}...` : text;
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
