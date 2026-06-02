import { MEA_GRID_COLUMNS, MEA_GRID_ROWS } from "../mapping.js?v=20260601-perf";
import { meaAccent, prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderCenterOfActivity(canvas, centers) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);

  const visibleCenters = centers.length ? centers : defaultCenters();
  const layout = centerPanelLayout(width, height, visibleCenters.length);

  for (let index = 0; index < visibleCenters.length; index += 1) {
    const center = visibleCenters[index];
    const { x, y } = layout.position(index);
    drawCenterPanel(ctx, x, y, layout.panelWidth, layout.panelHeight, index + 1, center);
  }
}

function centerPanelLayout(width, height, count) {
  const header = 12;
  const bottom = 12;
  const compact = width < 560;
  const columns = compact ? Math.min(2, count) : Math.min(4, count);
  const gap = compact ? 14 : 18;
  const rows = Math.ceil(count / columns);
  const panelWidth = Math.max(1, (width - gap * (columns + 1)) / columns);
  const panelHeight = Math.max(1, (height - header - bottom - gap * (rows - 1)) / rows);

  return {
    panelWidth,
    panelHeight,
    position(index) {
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
  const gridColumns = center?.gridColumns ?? MEA_GRID_COLUMNS;
  const gridRows = center?.gridRows ?? MEA_GRID_ROWS;
  const label = center?.label ?? `MEA ${meaId}`;

  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(x0 + 0.5, y0 + 0.5, width - 1, height - 1);
  ctx.strokeStyle = "#edf2f7";

  for (let col = 1; col < gridColumns; col += 1) {
    const x = x0 + (width * col) / gridColumns;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + height);
    ctx.stroke();
  }
  for (let row = 1; row < gridRows; row += 1) {
    const y = y0 + (height * row) / gridRows;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + width, y);
    ctx.stroke();
  }

  ctx.fillStyle = meaAccent(meaId);
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(compactLabel(label, width), x0 + 8, y0 + 14);

  if (!center?.active) {
    ctx.fillStyle = "#7a8794";
    ctx.fillText(width < 72 ? "0" : "quiet", x0 + 8, y0 + height - 10);
    return;
  }

  const x = x0 + ((center.x + 0.5) / gridColumns) * width;
  const y = y0 + ((center.y + 0.5) / gridRows) * height;
  ctx.fillStyle = meaAccent(meaId);
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#202722";
  ctx.fillText(width < 118 ? String(center.totalCrossings) : `${center.totalCrossings} crossings`, x0 + 8, y0 + height - 10);
}

function defaultCenters() {
  return Array.from({ length: 4 }, (_, index) => ({
    active: false,
    x: null,
    y: null,
    totalCrossings: 0,
    label: `MEA ${index + 1}`,
  }));
}

function compactLabel(label, width) {
  const limit = width < 120 ? 10 : 22;
  const text = String(label);
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}
