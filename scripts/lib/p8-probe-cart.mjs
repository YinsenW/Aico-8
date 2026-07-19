const ROM_SIZE = 0x8000
const MUSIC_BASE = 0x3100
const SFX_BASE = 0x3200

function sections(text) {
  const result = new Map()
  const marker = /^__([a-z0-9_]+)__\r?$/gm
  const matches = [...text.matchAll(marker)]
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]
    const start = current.index + current[0].length
    const end = matches[index + 1]?.index ?? text.length
    result.set(current[1], text.slice(start, end).replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
  }
  return result
}

function byte(value, label) {
  if (!/^[0-9a-f]{2}$/i.test(value)) throw new TypeError(`${label} must be one byte of hex`)
  return Number.parseInt(value, 16)
}

function loadSfx(rom, payload) {
  const lines = payload.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length > 64) throw new TypeError('P8 probe has more than 64 SFX rows')
  lines.forEach((line, sfx) => {
    const value = line.trim()
    if (!/^[0-9a-f]{168}$/i.test(value)) {
      throw new TypeError(`P8 SFX row ${sfx} must contain exactly 168 hex digits`)
    }
    const base = SFX_BASE + sfx * 68
    for (let note = 0; note < 32; note += 1) {
      const offset = 8 + note * 5
      const pitch = byte(value.slice(offset, offset + 2), `SFX ${sfx} pitch`) & 0x3f
      const waveform = Number.parseInt(value[offset + 2], 16)
      const volume = Number.parseInt(value[offset + 3], 16) & 0x07
      const effect = Number.parseInt(value[offset + 4], 16) & 0x07
      rom[base + note * 2] = pitch | ((waveform & 0x03) << 6)
      rom[base + note * 2 + 1] = ((waveform >> 2) & 0x01)
        | (volume << 1) | (effect << 4) | (waveform >= 8 ? 0x80 : 0)
    }
    for (let field = 0; field < 4; field += 1) {
      rom[base + 64 + field] = byte(value.slice(field * 2, field * 2 + 2),
        `SFX ${sfx} metadata`)
    }
  })
}

function loadMusic(rom, payload) {
  const lines = payload.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length > 64) throw new TypeError('P8 probe has more than 64 music rows')
  lines.forEach((line, pattern) => {
    const match = /^([0-9a-f]{2})\s+([0-9a-f]{8})$/i.exec(line.trim())
    if (!match) throw new TypeError(`P8 music row ${pattern} is malformed`)
    const flags = Number.parseInt(match[1], 16)
    for (let channel = 0; channel < 4; channel += 1) {
      let value = byte(match[2].slice(channel * 2, channel * 2 + 2),
        `music ${pattern} channel`)
      if (channel < 3 && (flags & (1 << channel)) !== 0) value |= 0x80
      rom[MUSIC_BASE + pattern * 4 + channel] = value
    }
  })
}

export function extractP8ProbeCart(cart, label = 'Probe') {
  const text = Buffer.isBuffer(cart) ? cart.toString('utf8') : String(cart)
  const parsed = sections(text)
  const source = parsed.get('lua')
  if (!source?.trim()) throw new TypeError(`${label} cart has no non-empty __lua__ section`)
  const allowed = new Set(['lua', 'gfx', 'sfx', 'music'])
  for (const [name, payload] of parsed) {
    if (!allowed.has(name) || (name === 'gfx' && payload.trim() !== '')) {
      throw new TypeError(`${label} candidate accepts Lua, SFX/music, and an empty __gfx__ terminator`)
    }
  }
  const rom = Buffer.alloc(ROM_SIZE)
  // The official editor initializes every otherwise-empty SFX row with speed
  // 16. This matters when code later fills note bytes directly (including the
  // P8SCII audio command), so source-only carts must not start from all-zero
  // SFX metadata.
  for (let sfx = 0; sfx < 64; sfx += 1) rom[SFX_BASE + sfx * 68 + 65] = 16
  if (parsed.has('sfx')) loadSfx(rom, parsed.get('sfx'))
  if (parsed.has('music')) loadMusic(rom, parsed.get('music'))
  return { source: Buffer.from(source, 'utf8'), rom }
}
