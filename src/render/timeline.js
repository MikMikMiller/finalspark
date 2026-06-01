import { prepareCanvas } from "./canvas.js?v=20260601-perf";

export function renderTimeline(canvas, history) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfdff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d7dee7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const left = 56;
  const right = 14;
  const top = 18;
  const bottom = 24;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxRate = Math.max(1, ...history.map((point) => point.populationRateHz));

  ctx.strokeStyle = "#edf2f7";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = top + (plotHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
  }

  if (history.length > 1) {
    ctx.beginPath();
    history.forEach((point, index) => {
      const x = left + (plotWidth * index) / (history.length - 1);
      const y = top + plotHeight - (plotHeight * point.populationRateHz) / maxRate;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#2ea3f2";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#68717a";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("0", left - 8, top + plotHeight);
}
