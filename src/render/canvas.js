export function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return { ctx, width: rect.width, height: rect.height, dpr };
}

export function drawPanelFrame(ctx, width, height, label) {
  ctx.save();
  ctx.strokeStyle = "#d7dee7";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = "#68717a";
  ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillText(label, 12, 18);
  ctx.restore();
}

export function rateColor(value, maxValue) {
  const t = maxValue <= 0 ? 0 : Math.min(1, value / maxValue);
  const cold = [236, 246, 255];
  const mid = [46, 163, 242];
  const hot = [235, 104, 23];
  const mix = t < 0.5
    ? lerpColor(cold, mid, t * 2)
    : lerpColor(mid, hot, (t - 0.5) * 2);
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

export function meaAccent(meaId) {
  return ["#2ea3f2", "#eb6817", "#386ca3", "#b24c43"][meaId - 1] ?? "#444";
}

function lerpColor(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}
