export function encodeWavePcm16(sampleRate, samples, channels = 1) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new TypeError('sampleRate is invalid')
  if (!Number.isSafeInteger(channels) || channels <= 0) throw new TypeError('channels is invalid')
  const values = samples instanceof Int16Array ? samples : Int16Array.from(samples)
  if (values.length % channels !== 0) throw new TypeError('PCM sample count is not channel-aligned')
  const dataBytes = values.byteLength
  const wav = Buffer.alloc(44 + dataBytes)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36 + dataBytes, 4)
  wav.write('WAVE', 8, 'ascii')
  wav.write('fmt ', 12, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * 2, 28)
  wav.writeUInt16LE(channels * 2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(dataBytes, 40)
  Buffer.from(values.buffer, values.byteOffset, values.byteLength).copy(wav, 44)
  return wav
}
