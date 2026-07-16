import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DOMParser } from "@xmldom/xmldom";

export const SEMANTIC_VECTOR_SOURCE_SCHEMA = "aico8.semantic-vector-source.v1";
export const SEMANTIC_VECTOR_SET_SCHEMA = "aico8.semantic-vector-set.v1";

const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const tokenPattern = /^[a-z][a-z0-9-]{1,63}$/;
const allowedElements = new Set(["svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const commonPaintAttributes = new Set([
  "id", "fill", "fill-opacity", "stroke", "stroke-opacity", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "data-aico8-fill-token", "data-aico8-stroke-token",
  "data-aico8-composite",
]);
const allowedAttributes = {
  svg: new Set([
    "xmlns", "viewBox", "width", "height", "data-aico8-schema", "data-aico8-asset-id",
    "data-aico8-origin", "data-aico8-required-layers",
  ]),
  g: new Set(["id"]),
  path: new Set([...commonPaintAttributes, "d"]),
  rect: new Set([...commonPaintAttributes, "x", "y", "width", "height", "rx", "ry"]),
  circle: new Set([...commonPaintAttributes, "cx", "cy", "r"]),
  ellipse: new Set([...commonPaintAttributes, "cx", "cy", "rx", "ry"]),
  line: new Set([...commonPaintAttributes, "x1", "y1", "x2", "y2"]),
  polyline: new Set([...commonPaintAttributes, "points"]),
  polygon: new Set([...commonPaintAttributes, "points"]),
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function elementChildren(element) {
  return Array.from(element.childNodes).filter((node) => node.nodeType === 1);
}

function attributes(element) {
  return Array.from(element.attributes ?? []);
}

function rejectNonElementContent(element) {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && node.nodeValue?.trim()) {
      throw new Error(`<${element.tagName}> cannot contain text content`);
    }
    if (![1, 3, 8].includes(node.nodeType)) {
      throw new Error(`<${element.tagName}> contains unsupported XML content`);
    }
  }
}

function numberAttribute(element, name, { defaultValue, positive = false } = {}) {
  const raw = element.getAttribute(name);
  if (raw === "" || raw === null) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`<${element.tagName}> requires ${name}`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`<${element.tagName}> ${name} must be ${positive ? "positive and " : ""}finite`);
  }
  return value;
}

function opacityAttribute(element, name) {
  const value = numberAttribute(element, name, { defaultValue: 1 });
  if (value < 0 || value > 1) throw new Error(`<${element.tagName}> ${name} must be between 0 and 1`);
  return value;
}

function color(value, element, attribute) {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`<${element.tagName}> ${attribute} must be #RRGGBB or none`);
  }
  return Number.parseInt(value.slice(1), 16);
}

function paint(element, kind) {
  const attribute = element.getAttribute(kind);
  const token = element.getAttribute(`data-aico8-${kind}-token`);
  if (attribute && token) throw new Error(`<${element.tagName}> cannot declare both ${kind} and a ${kind} token`);
  if (token && !tokenPattern.test(token)) throw new Error(`<${element.tagName}> has an invalid ${kind} token`);
  if ((!attribute || attribute === "none") && !token) return undefined;
  const result = {
    ...(token ? { token } : { color: color(attribute, element, kind) }),
    alpha: opacityAttribute(element, `${kind}-opacity`),
  };
  if (kind === "stroke") {
    const width = numberAttribute(element, "stroke-width", { positive: true });
    const cap = element.getAttribute("stroke-linecap") || "butt";
    const join = element.getAttribute("stroke-linejoin") || "miter";
    if (!["butt", "round", "square"].includes(cap)) throw new Error(`<${element.tagName}> has an invalid stroke-linecap`);
    if (!["bevel", "miter", "round"].includes(join)) throw new Error(`<${element.tagName}> has an invalid stroke-linejoin`);
    Object.assign(result, { width, cap, join });
  }
  return result;
}

function tokenizedNumbers(raw, label) {
  const tokens = [];
  const expression = /[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  let previous = 0;
  for (const match of raw.matchAll(expression)) {
    const gap = raw.slice(previous, match.index);
    if (!/^[\s,]*$/.test(gap)) throw new Error(`${label} contains unsupported syntax near ${JSON.stringify(gap)}`);
    tokens.push(match[0]);
    previous = match.index + match[0].length;
  }
  if (!/^[\s,]*$/.test(raw.slice(previous))) throw new Error(`${label} contains unsupported trailing syntax`);
  return tokens;
}

function pathCommands(raw, label) {
  const tokens = tokenizedNumbers(raw, label);
  const commands = [];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    if (!["M", "L", "C", "Q", "Z"].includes(command)) {
      throw new Error(`${label} supports only absolute M, L, C, Q, and Z commands`);
    }
    if (command === "Z") {
      commands.push({ op: "closePath", values: [] });
      continue;
    }
    const arity = command === "C" ? 6 : command === "Q" ? 4 : 2;
    let groups = 0;
    while (index < tokens.length && !/^[A-Za-z]$/.test(tokens[index])) {
      if (index + arity > tokens.length || tokens.slice(index, index + arity).some((token) => /^[A-Za-z]$/.test(token))) {
        throw new Error(`${label} has an incomplete ${command} command`);
      }
      const values = tokens.slice(index, index + arity).map(Number);
      if (values.some((value) => !Number.isFinite(value))) throw new Error(`${label} contains a non-finite coordinate`);
      const op = command === "M" && groups === 0 ? "moveTo"
        : command === "M" || command === "L" ? "lineTo"
          : command === "C" ? "bezierCurveTo" : "quadraticCurveTo";
      commands.push({ op, values });
      index += arity;
      groups += 1;
    }
    if (groups === 0) throw new Error(`${label} ${command} must contain coordinates`);
  }
  if (commands.length === 0) throw new Error(`${label} must not be empty`);
  return commands;
}

function pointsCommands(raw, label, closed) {
  const tokens = tokenizedNumbers(raw, label);
  if (tokens.some((token) => /^[A-Za-z]$/.test(token)) || tokens.length < 4 || tokens.length % 2 !== 0) {
    throw new Error(`${label} must contain at least two x,y pairs`);
  }
  const numbers = tokens.map(Number);
  const commands = [{ op: "moveTo", values: numbers.slice(0, 2) }];
  for (let index = 2; index < numbers.length; index += 2) {
    commands.push({ op: "lineTo", values: numbers.slice(index, index + 2) });
  }
  if (closed) commands.push({ op: "closePath", values: [] });
  return commands;
}

function shapeCommands(element) {
  const tag = element.tagName;
  if (tag === "path") return pathCommands(element.getAttribute("d") ?? "", `<path id=${element.getAttribute("id")}> d`);
  if (tag === "rect") {
    const x = numberAttribute(element, "x", { defaultValue: 0 });
    const y = numberAttribute(element, "y", { defaultValue: 0 });
    const width = numberAttribute(element, "width", { positive: true });
    const height = numberAttribute(element, "height", { positive: true });
    const rx = numberAttribute(element, "rx", { defaultValue: 0 });
    const ry = numberAttribute(element, "ry", { defaultValue: rx });
    if (rx < 0 || ry < 0 || rx !== ry) throw new Error(`<rect> requires equal non-negative rx and ry`);
    return [{ op: rx > 0 ? "roundRect" : "rect", values: rx > 0 ? [x, y, width, height, rx] : [x, y, width, height] }];
  }
  if (tag === "circle") return [{ op: "circle", values: [
    numberAttribute(element, "cx"), numberAttribute(element, "cy"), numberAttribute(element, "r", { positive: true }),
  ] }];
  if (tag === "ellipse") return [{ op: "ellipse", values: [
    numberAttribute(element, "cx"), numberAttribute(element, "cy"),
    numberAttribute(element, "rx", { positive: true }), numberAttribute(element, "ry", { positive: true }),
  ] }];
  if (tag === "line") return [
    { op: "moveTo", values: [numberAttribute(element, "x1"), numberAttribute(element, "y1")] },
    { op: "lineTo", values: [numberAttribute(element, "x2"), numberAttribute(element, "y2")] },
  ];
  return pointsCommands(element.getAttribute("points") ?? "", `<${tag}> points`, tag === "polygon");
}

function validateElementAttributes(element) {
  const allowed = allowedAttributes[element.tagName];
  for (const attribute of attributes(element)) {
    if (!allowed.has(attribute.name)) throw new Error(`<${element.tagName}> attribute ${attribute.name} is not allowed`);
    if (/^on/i.test(attribute.name) || /(?:javascript:|data:|url\s*\()/i.test(attribute.value)) {
      throw new Error(`<${element.tagName}> attribute ${attribute.name} contains executable or external content`);
    }
  }
}

export function compileSemanticSvg(source, sourcePath = "asset.svg") {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) {
    throw new Error(`${sourcePath} cannot contain document types or entity declarations`);
  }
  const xmlErrors = [];
  const document = new DOMParser({
    errorHandler: {
      warning: (message) => xmlErrors.push(message),
      error: (message) => xmlErrors.push(message),
      fatalError: (message) => xmlErrors.push(message),
    },
  }).parseFromString(source, "image/svg+xml");
  if (xmlErrors.length > 0) throw new Error(`Invalid SVG XML in ${sourcePath}: ${xmlErrors.join("; ")}`);
  const root = document.documentElement;
  if (!root || root.tagName !== "svg" || root.namespaceURI !== "http://www.w3.org/2000/svg") {
    throw new Error(`${sourcePath} must have an SVG namespace root`);
  }
  validateElementAttributes(root);
  if (root.getAttribute("data-aico8-schema") !== SEMANTIC_VECTOR_SOURCE_SCHEMA) {
    throw new Error(`${sourcePath} must declare ${SEMANTIC_VECTOR_SOURCE_SCHEMA}`);
  }
  const assetId = root.getAttribute("data-aico8-asset-id") ?? "";
  if (!idPattern.test(assetId)) throw new Error(`${sourcePath} has an invalid asset id`);
  if (path.basename(sourcePath, path.extname(sourcePath)) !== assetId) {
    throw new Error(`${sourcePath} filename must match asset id ${assetId}`);
  }
  const viewBox = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))
    || viewBox[0] !== 0 || viewBox[1] !== 0 || viewBox[2] <= 0 || viewBox[3] <= 0) {
    throw new Error(`${sourcePath} viewBox must be 0 0 width height with positive finite dimensions`);
  }
  const width = numberAttribute(root, "width", { positive: true });
  const height = numberAttribute(root, "height", { positive: true });
  if (width !== viewBox[2] || height !== viewBox[3]) throw new Error(`${sourcePath} width and height must match viewBox`);
  const origin = (root.getAttribute("data-aico8-origin") ?? "0 0").trim().split(/[\s,]+/).map(Number);
  if (origin.length !== 2 || origin.some((value) => !Number.isFinite(value))
    || origin[0] < 0 || origin[1] < 0 || origin[0] > width || origin[1] > height) {
    throw new Error(`${sourcePath} origin must be a finite point inside viewBox`);
  }
  const requiredLayerIds = (root.getAttribute("data-aico8-required-layers") ?? "").trim().split(/\s+/).filter(Boolean);
  if (requiredLayerIds.length === 0 || new Set(requiredLayerIds).size !== requiredLayerIds.length
    || requiredLayerIds.some((id) => !idPattern.test(id))) {
    throw new Error(`${sourcePath} must declare unique valid required layer ids`);
  }

  const ids = new Set();
  const groupIds = new Set();
  const primitives = [];
  function visit(element, layerIds) {
    if (!allowedElements.has(element.tagName)) throw new Error(`<${element.tagName}> is not in the semantic SVG subset`);
    validateElementAttributes(element);
    rejectNonElementContent(element);
    if (element !== root) {
      const id = element.getAttribute("id") ?? "";
      if (!idPattern.test(id)) throw new Error(`<${element.tagName}> requires a valid semantic id`);
      if (ids.has(id)) throw new Error(`Duplicate semantic id ${id}`);
      ids.add(id);
      if (element.tagName === "g") groupIds.add(id);
    }
    if (element.tagName === "g") {
      const nextLayers = [...layerIds, element.getAttribute("id")];
      for (const child of elementChildren(element)) visit(child, nextLayers);
      return;
    }
    if (element === root) {
      for (const child of elementChildren(element)) visit(child, layerIds);
      return;
    }
    if (elementChildren(element).length > 0) throw new Error(`<${element.tagName}> cannot contain child elements`);
    const fill = paint(element, "fill");
    const stroke = paint(element, "stroke");
    const composite = element.getAttribute("data-aico8-composite") || undefined;
    if (composite !== undefined && composite !== "cut") {
      throw new Error(`<${element.tagName}> ${element.getAttribute("id")} has an unsupported composite operation`);
    }
    if (composite && (fill || stroke)) {
      throw new Error(`<${element.tagName}> ${element.getAttribute("id")} cut composites may not declare paint`);
    }
    if (!fill && !stroke && !composite) {
      throw new Error(`<${element.tagName}> ${element.getAttribute("id")} must declare fill, stroke, or a cut composite`);
    }
    primitives.push({
      id: element.getAttribute("id"),
      layerIds,
      commands: shapeCommands(element),
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
      ...(composite ? { composite } : {}),
    });
  }
  visit(root, []);
  if (primitives.length === 0) throw new Error(`${sourcePath} must contain at least one drawable primitive`);
  for (const required of requiredLayerIds) {
    if (!groupIds.has(required)) throw new Error(`${sourcePath} required layer ${required} is missing or is not a group`);
    if (!primitives.some(({ layerIds }) => layerIds.includes(required))) {
      throw new Error(`${sourcePath} required layer ${required} has no drawable primitives`);
    }
  }
  const runtimeRecipe = {
    schemaVersion: SEMANTIC_VECTOR_SOURCE_SCHEMA,
    id: assetId,
    sourceSha256: sha256(source),
    sourceBytes: Buffer.byteLength(source),
    viewBox,
    origin,
    requiredLayerIds,
    elementIds: [...ids],
    primitives,
  };
  return { ...runtimeRecipe, recipeSha256: sha256(JSON.stringify(runtimeRecipe)) };
}

export function compileSemanticSvgDirectory(directory, relativeRoot = "vector-assets") {
  if (!fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".svg")).sort();
  if (files.length === 0) throw new Error(`Semantic vector directory is empty: ${directory}`);
  const assets = files.map((name) => compileSemanticSvg(fs.readFileSync(path.join(directory, name), "utf8"), name));
  const ids = assets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Semantic vector asset ids must be unique");
  return {
    schemaVersion: SEMANTIC_VECTOR_SET_SCHEMA,
    assets,
    sourceFiles: files.map((name) => ({
      absolutePath: path.join(directory, name),
      path: path.posix.join(relativeRoot, name),
    })),
  };
}

export function semanticVectorManifest(vectorSet) {
  return {
    schemaVersion: vectorSet.schemaVersion,
    assets: vectorSet.assets.map(({ id, sourceSha256, sourceBytes, recipeSha256, viewBox, origin, requiredLayerIds, elementIds }) => ({
      id, sourcePath: vectorSet.sourceFiles.find(({ path: sourcePath }) => sourcePath.endsWith(`/${id}.svg`))?.path,
      sourceSha256, sourceBytes, recipeSha256, viewBox, origin, requiredLayerIds, elementIds,
    })),
  };
}

export function semanticVectorModuleSource(vectorSet, importPath = "../../runtime/semantic-vector.js") {
  const record = Object.fromEntries(vectorSet.assets.map((asset) => [asset.id, asset]));
  return `// Generated from validated private SVG authoring sources. Do not edit.\n`
    + `import type { SemanticVectorAsset } from ${JSON.stringify(importPath)};\n\n`
    + `export const SEMANTIC_VECTOR_ASSETS = ${JSON.stringify(record, null, 2)} as const satisfies Readonly<Record<string, SemanticVectorAsset>>;\n`;
}
