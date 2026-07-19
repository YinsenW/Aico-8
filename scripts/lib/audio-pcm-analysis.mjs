export function summarizePcm16(samples, {
  sampleRate = 22050,
  startSample = 0,
  sampleCount = samples.length - startSample,
} = {}) {
  if (!(samples instanceof Int16Array)) throw new TypeError('samples must be Int16Array')
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new TypeError('sampleRate is invalid')
  if (!Number.isSafeInteger(startSample) || startSample < 0
      || !Number.isSafeInteger(sampleCount) || sampleCount <= 0
      || startSample + sampleCount > samples.length) {
    throw new RangeError('PCM analysis window is invalid')
  }
  let zeroCrossings = 0
  let peak = 0
  let squareSum = 0
  for (let index = startSample; index < startSample + sampleCount; index += 1) {
    const sample = samples[index]
    if (index > startSample) {
      const previous = samples[index - 1]
      if ((previous < 0 && sample >= 0) || (previous >= 0 && sample < 0)) zeroCrossings += 1
    }
    peak = Math.max(peak, Math.abs(sample))
    squareSum += sample * sample
  }
  return {
    sampleRate,
    startSample,
    sampleCount,
    zeroCrossings,
    estimatedFrequencyHz: zeroCrossings / 2 / (sampleCount / sampleRate),
    peak,
    rms: Math.sqrt(squareSum / sampleCount),
  }
}

export function comparePcmSummaries(official, candidate, tolerances) {
  const relative = (left, right) => Math.abs(left - right) / Math.max(1, Math.abs(left))
  const checks = {
    sampleRate: official.sampleRate === candidate.sampleRate,
    zeroCrossings: Math.abs(official.zeroCrossings - candidate.zeroCrossings)
      <= tolerances.zeroCrossings,
    frequency: relative(official.estimatedFrequencyHz, candidate.estimatedFrequencyHz)
      <= tolerances.frequencyRelative,
    peak: relative(official.peak, candidate.peak) <= tolerances.peakRelative,
    rms: relative(official.rms, candidate.rms) <= tolerances.rmsRelative,
  }
  return { matches: Object.values(checks).every(Boolean), checks }
}
