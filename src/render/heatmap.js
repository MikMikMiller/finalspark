import { electrodeGridForMea, formatChannelLabel } from "../mapping.js";
import { meaAccent, prepareCanvas, rateColor } from "./canvas.js";

export function renderHeatmap(canvas, rates, { useAbsoluteIndex }) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);

  const maxRate = Math.max(1, ...rates);
  const gap = 18;
  const panelWidth = (width - gap * 5) / 4;
  const panelHeight = height - 42;

  for (let meaId = 1; meaId <= 4; meaId += 1) {
    const x0 = gap + (meaId - 1) * (panelWidth + gap);
    const y0 = 28;
    drawMeaHeatmap(ctx, x0, y0, panelWidth, panelHeight, meaId, rates, maxRate, useAbsoluteIndex);
  }

  ctx.fillStyle = "#2d342f";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(`Firing rate heatmap, max ${maxRate.toFixed(1)} Hz`, 14, 18);
}

function drawMeaHeatmap(ctx, x0, y0, width, height, meaId, rates, maxRate, useAbsoluteIndex) {
  const titleHeight = 20;
  const cellGap = 3;
  const cellWidth = (width - cellGap * 7) / 8;
  const cellHeight = (height - titleHeight - cellGap * 3) / 4;
  const grid = electrodeGridForMea(meaId);

  ctx.strokeStyle = "#d8ddd7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.fillStyle = meaAccent(meaId);
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(`MEA ${meaId}`, x0 + 8, y0 + 14);

  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const channel = grid[row][col];
      const value = rates[channel.absoluteIndex] ?? 0;
      const x = x0 + col * (cellWidth + cellGap);
      const y = y0 + titleHeight + row * (cellHeight + cellGap);

      ctx.fillStyle = rateColor(value, maxRate);
      ctx.fillRect(x, y, cellWidth, cellHeight);
      ctx.strokeStyle = "rgba(20, 25, 21, 0.18)";
      ctx.strokeRect(x + 0.5, y + 0.5, cellWidth - 1, cellHeight - 1);
      ctx.fillStyle = value > maxRate * 0.55 ? "#fffdf5" : "#26302a";
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.fillText(formatChannelLabel(channel, useAbsoluteIndex), x + 4, y + 13);
    }
  }
}
