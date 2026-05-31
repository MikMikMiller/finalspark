import { prepareCanvas } from "./canvas.js";

export function renderTimeline(canvas, history) {
  const { ctx, width, height } = prepareCanvas(canvas);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#d8ddd7";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  const left = 40;
  const right = 14;
  const top = 18;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxRate = Math.max(1, ...history.map((point) => point.populationRateHz));

  ctx.strokeStyle = "#edf0ea";
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
    ctx.strokeStyle = "#257e6f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.fillStyle = "#2d342f";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText("Population activity timeline", left, 14);
  ctx.fillStyle = "#66716b";
  ctx.fillText(`${maxRate.toFixed(1)} Hz`, 6, top + 6);
  ctx.fillText("0", 25, top + plotHeight);
}
