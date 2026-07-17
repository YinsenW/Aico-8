import { decodePngRgba, encodePngRgba } from './png-rgba.mjs'

const LOGICAL_SIZE = 128
const ORIGIN_MARKER = Object.freeze([
  [255, 0, 77, 255],
  [255, 163, 0, 255],
  [255, 236, 39, 255],
  [0, 228, 54, 255],
])

function pixel(rgba, width, x, y) {
  const offset = (y * width + x) * 4
  return rgba.subarray(offset, offset + 4)
}

function equalPixel(left, right) {
  return left[0] === right[0] && left[1] === right[1]
    && left[2] === right[2] && left[3] === right[3]
}

export function normalizePico8LiveFramePng(input) {
  const decoded = decodePngRgba(input)
  if (decoded.width % LOGICAL_SIZE !== 0 || decoded.height % LOGICAL_SIZE !== 0) {
    throw new Error('Live-frame PNG dimensions must be integer multiples of 128')
  }
  const scaleX = decoded.width / LOGICAL_SIZE
  const scaleY = decoded.height / LOGICAL_SIZE
  if (scaleX !== scaleY || !Number.isSafeInteger(scaleX) || scaleX < 1) {
    throw new Error('Live-frame PNG must use one square integer pixel scale')
  }

  const rgba = Buffer.alloc(LOGICAL_SIZE * LOGICAL_SIZE * 4)
  for (let y = 0; y < LOGICAL_SIZE; y += 1) {
    for (let x = 0; x < LOGICAL_SIZE; x += 1) {
      const reference = pixel(decoded.rgba, decoded.width, x * scaleX, y * scaleY)
      for (let sourceY = y * scaleY; sourceY < (y + 1) * scaleY; sourceY += 1) {
        for (let sourceX = x * scaleX; sourceX < (x + 1) * scaleX; sourceX += 1) {
          if (!equalPixel(reference, pixel(decoded.rgba, decoded.width, sourceX, sourceY))) {
            throw new Error(`Live-frame logical pixel ${x},${y} is not a uniform nearest-neighbour block`)
          }
        }
      }
      reference.copy(rgba, (y * LOGICAL_SIZE + x) * 4)
    }
  }

  const marker = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) =>
    Array.from(pixel(rgba, LOGICAL_SIZE, x, y)))
  if (marker.some((value, index) => !equalPixel(value, ORIGIN_MARKER[index]))) {
    throw new Error(`Live-frame origin marker mismatch: ${JSON.stringify(marker)}`)
  }

  return {
    png: encodePngRgba(LOGICAL_SIZE, LOGICAL_SIZE, rgba),
    rgba,
    inputDimensions: [decoded.width, decoded.height],
    outputDimensions: [LOGICAL_SIZE, LOGICAL_SIZE],
    scale: scaleX,
    marker,
  }
}
