import { MEA_GRID_COLUMNS, MEA_GRID_ROWS } from "../mapping.js";
import { meaAccent, prepareCanvas } from "./canvas.js";

export function renderCenterOfActivity(canvas, centers) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);

  const gap = 18;
  const panelWidth = (width - gap * 5) / 4;
  const panelHeight = height - 34;

  ctx.fillStyle = "#2d342f";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(width < 520 ? "Center of Activity" : "Center of Activity, weighted by threshold crossings", 14, 18);

  for (let meaId = 1; meaId <= 4; meaId += 1) {
    const center = centers[meaId - 1];
    const x0 = gap + (meaId - 1) * (panelWidth + gap);
    const y0 = 30;
    drawCenterPanel(ctx, x0, y0, panelWidth, panelHeight, meaId, center);
  }
}

function drawCenterPanel(ctx, x0, y0, width, height, meaId, center) {
  ctx.strokeStyle = "#d8ddd7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.strokeStyle = "#edf0ea";

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
  ctx.fillText(`MEA ${meaId}`, x0 + 8, y0 + 14);

  if (!center?.active) {
    ctx.fillStyle = "#8a948c";
    ctx.fillText(width < 72 ? "0" : "quiet", x0 + 8, y0 + height - 10);
    return;
  }

  const x = x0 + ((center.x + 0.5) / MEA_GRID_COLUMNS) * width;
  const y = y0 + ((center.y + 0.5) / MEA_GRID_ROWS) * height;
  ctx.fillStyle = meaAccent(meaId);
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fffdf5";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#2d342f";
  ctx.fillText(width < 72 ? String(center.totalSpikes) : `${center.totalSpikes} crossings`, x0 + 8, y0 + height - 10);
}
