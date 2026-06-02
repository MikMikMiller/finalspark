export function computeCrossingRates(crossingCounts, windowMs) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError("windowMs must be a positive number");
  }

  const seconds = windowMs / 1000;
  return Float32Array.from(crossingCounts, (count) => round(count / seconds, 3));
}

export function computeCenterOfActivity(localCrossingCounts, channels) {
  let weightedX = 0;
  let weightedY = 0;
  let totalCrossings = 0;

  for (let index = 0; index < localCrossingCounts.length; index += 1) {
    const count = localCrossingCounts[index];
    if (count <= 0) continue;
    const channel = channels[index];
    weightedX += channel.x * count;
    weightedY += channel.y * count;
    totalCrossings += count;
  }

  if (totalCrossings === 0) {
    return {
      active: false,
      x: null,
      y: null,
      totalCrossings: 0,
    };
  }

  return {
    active: true,
    x: round(weightedX / totalCrossings, 3),
    y: round(weightedY / totalCrossings, 3),
    totalCrossings,
  };
}

export function computePopulationActivity(crossingCounts, windowMs) {
  const seconds = windowMs / 1000;
  let activeChannels = 0;
  let totalCrossings = 0;

  for (const count of crossingCounts) {
    if (count > 0) activeChannels += 1;
    totalCrossings += count;
  }

  return {
    activeChannels,
    totalCrossings,
    populationRateHz: round(totalCrossings / seconds, 3),
    meanChannelRateHz: round(totalCrossings / seconds / crossingCounts.length, 3),
  };
}

export function splitCountsByMea(crossingCounts) {
  return [0, 1, 2, 3].map((meaIndex) =>
    crossingCounts.slice(meaIndex * 32, meaIndex * 32 + 32),
  );
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
