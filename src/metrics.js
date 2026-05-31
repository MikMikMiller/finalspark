export function computeFiringRates(spikeCounts, windowMs) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError("windowMs must be a positive number");
  }

  const seconds = windowMs / 1000;
  return Float32Array.from(spikeCounts, (count) => round(count / seconds, 3));
}

export function computeCenterOfActivity(localSpikeCounts, channels) {
  let weightedX = 0;
  let weightedY = 0;
  let totalSpikes = 0;

  for (let index = 0; index < localSpikeCounts.length; index += 1) {
    const count = localSpikeCounts[index];
    if (count <= 0) continue;
    const channel = channels[index];
    weightedX += channel.x * count;
    weightedY += channel.y * count;
    totalSpikes += count;
  }

  if (totalSpikes === 0) {
    return {
      active: false,
      x: null,
      y: null,
      totalSpikes: 0,
    };
  }

  return {
    active: true,
    x: round(weightedX / totalSpikes, 3),
    y: round(weightedY / totalSpikes, 3),
    totalSpikes,
  };
}

export function computePopulationActivity(spikeCounts, windowMs) {
  const seconds = windowMs / 1000;
  let activeChannels = 0;
  let totalSpikes = 0;

  for (const count of spikeCounts) {
    if (count > 0) activeChannels += 1;
    totalSpikes += count;
  }

  return {
    activeChannels,
    totalSpikes,
    populationRateHz: round(totalSpikes / seconds, 3),
    meanChannelRateHz: round(totalSpikes / seconds / spikeCounts.length, 3),
  };
}

export function splitCountsByMea(spikeCounts) {
  return [0, 1, 2, 3].map((meaIndex) =>
    spikeCounts.slice(meaIndex * 32, meaIndex * 32 + 32),
  );
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
