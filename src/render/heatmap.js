import { electrodeGridForMea, formatChannelLabel } from "../mapping.js?v=20260601-perf";
import { meaAccent, prepareCanvas, rateColor } from "./canvas.js?v=20260601-perf";

export function renderHeatmap(canvas, rates, { useAbsoluteIndex, scaleMaxHz = 20, layout = null }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);

  const maxRate = Math.max(1, scaleMaxHz);
  if (!isMeaLayout(layout, rates.length)) {
    drawGenericHeatmap(ctx, 18, 18, width - 36, height - 36, rates, maxRate, useAbsoluteIndex, layout);
    return;
  }

  const panelLayout = meaPanelLayout(width, height);

  for (let meaId = 1; meaId <= 4; meaId += 1) {
    const { x, y } = panelLayout.position(meaId);
    drawMeaHeatmap(ctx, x, y, panelLayout.panelWidth, panelLayout.panelHeight, meaId, rates, maxRate, useAbsoluteIndex);
  }
}

function drawGenericHeatmap(ctx, x0, y0, width, height, rates, maxRate, useAbsoluteIndex, layout) {
  const channelCount = Math.max(1, rates.length);
  const columns = Math.max(1, Math.min(16, Math.ceil(Math.sqrt(channelCount * Math.max(1, width / Math.max(1, height))))));
  const rows = Math.ceil(channelCount / columns);
  const titleHeight = 22;
  const cellGap = 4;
  const cellWidth = Math.max(1, (width - cellGap * (columns - 1)) / columns);
  const cellHeight = Math.max(1, (height - titleHeight - cellGap * (rows - 1)) / rows);
  const group = Array.isArray(layout?.groups) ? layout.groups[0] : null;

  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.fillStyle = meaAccent(group?.id ?? 1);
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(group?.label ?? "Channels", x0 + 8, y0 + 14);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const col = channel % columns;
    const row = Math.floor(channel / columns);
    const value = rates[channel] ?? 0;
    const x = x0 + col * (cellWidth + cellGap);
    const y = y0 + titleHeight + row * (cellHeight + cellGap);

    ctx.fillStyle = rateColor(value, maxRate);
    ctx.fillRect(x, y, cellWidth, cellHeight);
    ctx.strokeStyle = "rgba(32, 39, 34, 0.18)";
    ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
    if (cellWidth >= 24 && cellHeight >= 18) {
      ctx.fillStyle = value > maxRate * 0.55 ? "#ffffff" : "#202722";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(useAbsoluteIndex ? String(channel) : `C${channel}`, x + cellWidth / 2, y + cellHeight / 2);
    }
  }
}

function isMeaLayout(layout, channelCount) {
  return channelCount === 128 &&
    Array.isArray(layout?.groups) &&
    layout.groups.length === 4 &&
    layout.groups.every((group, index) => group.startChannel === index * 32 && group.channelCount === 32);
}

function meaPanelLayout(width, height) {
  const header = 12;
  const bottom = 12;
  const compact = width < 560;
  const columns = compact ? 2 : 4;
  const gap = compact ? 14 : 18;
  const rows = Math.ceil(4 / columns);
  const panelWidth = Math.max(1, (width - gap * (columns + 1)) / columns);
  const panelHeight = Math.max(1, (height - header - bottom - gap * (rows - 1)) / rows);

  return {
    panelWidth,
    panelHeight,
    position(meaId) {
      const index = meaId - 1;
      const col = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: gap + col * (panelWidth + gap),
        y: header + row * (panelHeight + gap),
      };
    },
  };
}

function drawMeaHeatmap(ctx, x0, y0, width, height, meaId, rates, maxRate, useAbsoluteIndex) {
  const titleHeight = 20;
  const cellGap = 3;
  const cellWidth = (width - cellGap * 7) / 8;
  const cellHeight = (height - titleHeight - cellGap * 3) / 4;
  const grid = electrodeGridForMea(meaId);

  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.fillStyle = meaAccent(meaId);
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`MEA ${meaId}`, x0 + 8, y0 + 14);

  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const channel = grid[row][col];
      const value = rates[channel.absoluteIndex] ?? 0;
      const x = x0 + col * (cellWidth + cellGap);
      const y = y0 + titleHeight + row * (cellHeight + cellGap);

      ctx.fillStyle = rateColor(value, maxRate);
      ctx.fillRect(x, y, cellWidth, cellHeight);
      ctx.strokeStyle = "rgba(32, 39, 34, 0.18)";
      ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
      const canShowLabel = useAbsoluteIndex ? cellWidth >= 23 && cellHeight >= 18 : cellWidth >= 15 && cellHeight >= 16;
      if (canShowLabel) {
        ctx.fillStyle = value > maxRate * 0.55 ? "#ffffff" : "#202722";
        ctx.font = `${cellWidth < 18 ? 9 : 10}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(formatChannelLabel(channel, useAbsoluteIndex), x + cellWidth / 2, y + cellHeight / 2);
      }
    }
  }
}
