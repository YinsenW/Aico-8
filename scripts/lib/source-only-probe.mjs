export function extractSourceOnlyProbe(cart, label = 'Probe') {
  const text = cart.toString('utf8')
  const lua = /^__lua__\r?$/m.exec(text)
  if (!lua || lua.index === undefined) throw new Error(`${label} cart has no __lua__ section`)
  const start = lua.index + lua[0].length
  const remainder = text.slice(start).replace(/^\r?\n/, '')
  const section = /^__([a-z0-9_]+)__\r?$/m.exec(remainder)
  const source = section?.index === undefined ? remainder : remainder.slice(0, section.index)
  const resources = section?.index === undefined ? '' : remainder.slice(section.index + section[0].length)
  if (section && (section[1] !== 'gfx' || resources.trim() !== '')) {
    throw new Error(`${label} candidate capture accepts source-only probes or an empty __gfx__ terminator`)
  }
  if (source.trim() === '') throw new Error(`${label} Lua source is empty`)
  return Buffer.from(source, 'utf8')
}
