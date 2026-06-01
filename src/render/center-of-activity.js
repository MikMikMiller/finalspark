import { MEA_GRID_COLUMNS, MEA_GRID_ROWS } from "../mapping.js?v=20260601-perf";
import { meaAccent, prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderCenterOfActivity(canvas, centers) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);

  const layout = meaPanelLayout(width, height);

  for (let meaId = 1; meaId <= 4; meaId += 1) {
    const center = centers[meaId - 1];
    const { x, y } = layout.position(meaId);
    drawCenterPanel(ctx, x, y, layout.panelWidth, layout.panelHeight, meaId, center);
  }
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

function drawCenterPanel(ctx, x0, y0, width, height, meaId, center) {
  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.strokeStyle = "#edf2f7";

  for (let col = 1; col < MEA_GRID_COLUMNS; col += 1) {
    const x = x0 + (width * col) / MEA_GRID_COLUMNS;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + height);
    ctx.stroke();
  }
  for (let row = 1; row < MEA_GRID_ROWS; row += 1) {
    const y = y0 + (height * row) / MEA_GRID_ROWS;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + width, y);
    ctx.stroke();
  }

  ctx.fillStyle = meaAccent(meaId);
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`MEA ${meaId}`, x0 + 8, y0 + 14);

  if (!center?.active) {
    ctx.fillStyle = "#7a8794";
    ctx.fillText(width < 72 ? "0" : "quiet", x0 + 8, y0 + height - 10);
    return;
  }

  const x = x0 + ((center.x + 0.5) / MEA_GRID_COLUMNS) * width;
  const y = y0 + ((center.y + 0.5) / MEA_GRID_ROWS) * height;
  ctx.fillStyle = meaAccent(meaId);
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#202722";
  ctx.fillText(width < 118 ? String(center.totalSpikes) : `${center.totalSpikes} crossings`, x0 + 8, y0 + height - 10);
}
