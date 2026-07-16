import { deflateSync, inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_PIXELS = 16_777_216

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

export function decodePngRgba(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('PNG signature is invalid')
  }
  let offset = 8
  let header
  let palette
  let transparency
  const compressed = []
  let sawEnd = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('PNG chunk header is truncated')
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('PNG chunk data is truncated')
    const typeBytes = bytes.subarray(offset + 4, offset + 8)
    const type = typeBytes.toString('ascii')
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const expectedCrc = bytes.readUInt32BE(offset + 8 + length)
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) {
      throw new Error(`PNG ${type} chunk CRC is invalid`)
    }
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('PNG must contain one valid IHDR chunk')
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'PLTE') {
      palette = Buffer.from(data)
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data)
    } else if (type === 'IDAT') {
      compressed.push(Buffer.from(data))
    } else if (type === 'IEND') {
      sawEnd = true
      offset = end
      break
    }
    offset = end
  }
  if (!header || !sawEnd || compressed.length === 0) throw new Error('PNG is incomplete')
  const { width, height, bitDepth, colorType, compression, filter, interlace } = header
  if (width === 0 || height === 0 || width * height > MAX_PIXELS) {
    throw new Error('PNG dimensions are invalid or exceed the evidence limit')
  }
  if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
    throw new Error('PNG evidence must use non-interlaced 8-bit standard compression and filters')
  }
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType)
  if (!channels) throw new Error(`PNG colour type ${colorType} is unsupported`)
  if (colorType === 3 && (!palette || palette.length === 0 || palette.length % 3 !== 0)) {
    throw new Error('Indexed PNG is missing a valid palette')
  }
  const stride = width * channels
  const inflated = inflateSync(Buffer.concat(compressed))
  if (inflated.length !== height * (stride + 1)) throw new Error('PNG scanline length is invalid')
  const raw = Buffer.alloc(height * stride)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filterType = inflated[sourceOffset]
    sourceOffset += 1
    if (filterType > 4) throw new Error(`PNG scanline filter ${filterType} is unsupported`)
    const rowOffset = y * stride
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[sourceOffset + x]
      const left = x >= channels ? raw[rowOffset + x - channels] : 0
      const above = y > 0 ? raw[rowOffset - stride + x] : 0
      const upperLeft = y > 0 && x >= channels
        ? raw[rowOffset - stride + x - channels]
        : 0
      const predictor = filterType === 1 ? left
        : filterType === 2 ? above
          : filterType === 3 ? Math.floor((left + above) / 2)
            : filterType === 4 ? paeth(left, above, upperLeft)
              : 0
      raw[rowOffset + x] = (encoded + predictor) & 0xff
    }
    sourceOffset += stride
  }
  const rgba = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels
    const destination = pixel * 4
    if (colorType === 0) {
      rgba.fill(raw[source], destination, destination + 3)
      rgba[destination + 3] = 255
    } else if (colorType === 2) {
      raw.copy(rgba, destination, source, source + 3)
      rgba[destination + 3] = 255
    } else if (colorType === 3) {
      const index = raw[source]
      if (index * 3 + 2 >= palette.length) throw new Error('Indexed PNG references a missing colour')
      palette.copy(rgba, destination, index * 3, index * 3 + 3)
      rgba[destination + 3] = transparency?.[index] ?? 255
    } else if (colorType === 4) {
      rgba.fill(raw[source], destination, destination + 3)
      rgba[destination + 3] = raw[source + 1]
    } else {
      raw.copy(rgba, destination, source, source + 4)
    }
  }
  return { width, height, rgba }
}

export function encodePngRgba(width, height, rgba, { compressionLevel = 9 } = {}) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width <= 0 || height <= 0 || width * height > MAX_PIXELS) {
    throw new Error('PNG dimensions are invalid or exceed the evidence limit')
  }
  const pixels = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba)
  if (pixels.length !== width * height * 4) throw new Error('RGBA byte length does not match PNG dimensions')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y += 1) {
    const destination = y * (width * 4 + 1)
    scanlines[destination] = 0
    pixels.copy(scanlines, destination + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: compressionLevel })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
