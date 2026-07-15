export const QUALITY_LEAP_AUDIT_SCHEMA_VERSION = "aico8.quality-leap-audit.v1" as const;

export type QualityLeapGeometrySource =
  | "frozen-hd-asset"
  | "semantic-command-reconstruction"
  | "authored-procedural"
  | "final-framebuffer-projection";
export type QualityLeapSamplingSource = "element-resource" | "semantic-command" | "final-framebuffer";
export type QualityLeapContourTreatment = "authored-continuous" | "density-aware-raster" | "source-cell-topology";
export type QualityLeapVisibilityEffectPolicy =
  | "not-applicable"
  | "semantic-command"
  | "final-framebuffer-visibility-oracle";
export type QualityLeapDimension =
  | "continuous-contour"
  | "density-aware-sampling"
  | "material-layers"
  | "internal-detail"
  | "animation"
  | "effects";
export type QualityLeapRegressionCategory =
  | "shell-only-mutation"
  | "final-framebuffer-topology-mutation"
  | "cosmetic-smoothing-only-mutation"
  | "source-visibility-effect-bypass-mutation";

export interface QualityLeapRouteV1 {
  readonly id: string;
  readonly role: "content" | "shell";
  readonly sceneIds: readonly string[];
  readonly geometrySource: QualityLeapGeometrySource;
  readonly samplingSource: QualityLeapSamplingSource;
  readonly contourTreatment: QualityLeapContourTreatment;
  readonly visibilityEffectPolicy: QualityLeapVisibilityEffectPolicy;
  readonly visibilityEffectComposited: boolean;
  readonly targetPixelsPerSourcePixel: number;
  readonly edgeSupersampleFactor: number;
  readonly qualityDimensions: readonly QualityLeapDimension[];
  readonly materialLayerCount: number;
  readonly authoredDetailCount: number;
  readonly motionOrEffectTrackCount: number;
}

export interface QualityLeapAuditV1 {
  readonly schemaVersion: typeof QUALITY_LEAP_AUDIT_SCHEMA_VERSION;
  readonly gameId: string;
  readonly canonicalReplaySha256: string;
  readonly presentationAuditSha256: string;
  readonly status: "draft" | "accepted";
  readonly scenes: readonly {
    readonly id: string;
    readonly observedContentRouteIds: readonly string[];
  }[];
  readonly routes: readonly QualityLeapRouteV1[];
  readonly regressions: readonly {
    readonly id: string;
    readonly category: QualityLeapRegressionCategory;
    readonly rejected: true;
  }[];
}

export interface QualityLeapAuditValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const GEOMETRY_SOURCES = new Set<QualityLeapGeometrySource>([
  "frozen-hd-asset", "semantic-command-reconstruction", "authored-procedural", "final-framebuffer-projection",
]);
const SAMPLING_SOURCES = new Set<QualityLeapSamplingSource>(["element-resource", "semantic-command", "final-framebuffer"]);
const CONTOUR_TREATMENTS = new Set<QualityLeapContourTreatment>([
  "authored-continuous", "density-aware-raster", "source-cell-topology",
]);
const VISIBILITY_EFFECT_POLICIES = new Set<QualityLeapVisibilityEffectPolicy>([
  "not-applicable", "semantic-command", "final-framebuffer-visibility-oracle",
]);
const QUALITY_DIMENSIONS = new Set<QualityLeapDimension>([
  "continuous-contour", "density-aware-sampling", "material-layers", "internal-detail", "animation", "effects",
]);
const REQUIRED_REGRESSIONS = new Set<QualityLeapRegressionCategory>([
  "shell-only-mutation", "final-framebuffer-topology-mutation", "cosmetic-smoothing-only-mutation",
  "source-visibility-effect-bypass-mutation",
]);

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, keys: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function id(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !ID.test(value)) {
    errors.push(`${path} must be a valid id`);
    return false;
  }
  return true;
}

function uniqueIds(value: unknown, path: string, errors: string[], minimum = 0): string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    errors.push(`${path} must contain at least ${minimum} id${minimum === 1 ? "" : "s"}`);
    return [];
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    if (!id(candidate, `${path}[${index}]`, errors)) continue;
    if (seen.has(candidate)) errors.push(`${path}[${index}] must be unique`);
    else { seen.add(candidate); result.push(candidate); }
  }
  return result;
}

function nonNegativeInteger(value: unknown, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    errors.push(`${path} must be a non-negative integer`);
    return false;
  }
  return true;
}

function qualityRouteErrors(route: UnknownRecord, path: string, errors: string[]): void {
  if (route.geometrySource === "final-framebuffer-projection" || route.samplingSource === "final-framebuffer") {
    errors.push(`${path} content geometry must not derive from the final framebuffer`);
  }
  if (route.contourTreatment === "source-cell-topology") {
    errors.push(`${path} content contour must not preserve per-pixel source-cell topology as the finished surface`);
  }
  if (route.visibilityEffectPolicy !== "not-applicable" && route.visibilityEffectComposited !== true) {
    errors.push(`${path} source visibility effect is not composited into the finished content route`);
  }
  if (typeof route.targetPixelsPerSourcePixel !== "number" || route.targetPixelsPerSourcePixel < 4) {
    errors.push(`${path} needs at least four target pixels per source pixel`);
  }
  if (typeof route.edgeSupersampleFactor !== "number" || route.edgeSupersampleFactor < 2) {
    errors.push(`${path} needs deterministic edge supersampling`);
  }
  const dimensions = new Set(Array.isArray(route.qualityDimensions) ? route.qualityDimensions : []);
  const shapeLeap = dimensions.has("continuous-contour") || dimensions.has("density-aware-sampling");
  const enrichment = (dimensions.has("material-layers") && typeof route.materialLayerCount === "number" && route.materialLayerCount >= 3)
    || (dimensions.has("internal-detail") && typeof route.authoredDetailCount === "number" && route.authoredDetailCount >= 1)
    || ((dimensions.has("animation") || dimensions.has("effects"))
      && typeof route.motionOrEffectTrackCount === "number" && route.motionOrEffectTrackCount >= 1);
  if (!shapeLeap) errors.push(`${path} lacks a continuous-contour or density-aware sampling gain`);
  if (!enrichment) errors.push(`${path} is cosmetic smoothing only; it lacks material, authored detail, animation, or effects gain`);
}

export function validateQualityLeapAudit(value: unknown): QualityLeapAuditValidationResult {
  const errors: string[] = [];
  if (!record(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, [
    "schemaVersion", "gameId", "canonicalReplaySha256", "presentationAuditSha256", "status", "scenes", "routes", "regressions",
  ], "$", errors);
  if (value.schemaVersion !== QUALITY_LEAP_AUDIT_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${QUALITY_LEAP_AUDIT_SCHEMA_VERSION}`);
  id(value.gameId, "$.gameId", errors);
  for (const key of ["canonicalReplaySha256", "presentationAuditSha256"] as const) {
    if (typeof value[key] !== "string" || !HASH.test(value[key])) errors.push(`$.${key} must be a sha256`);
  }
  if (value.status !== "draft" && value.status !== "accepted") errors.push("$.status is unsupported");

  const routes = new Map<string, UnknownRecord>();
  if (!Array.isArray(value.routes) || value.routes.length === 0) errors.push("$.routes must be a non-empty array");
  else value.routes.forEach((routeValue, index) => {
    const path = `$.routes[${index}]`;
    if (!record(routeValue)) { errors.push(`${path} must be an object`); return; }
    exactKeys(routeValue, [
      "id", "role", "sceneIds", "geometrySource", "samplingSource", "contourTreatment", "targetPixelsPerSourcePixel",
      "visibilityEffectPolicy", "visibilityEffectComposited", "edgeSupersampleFactor", "qualityDimensions", "materialLayerCount",
      "authoredDetailCount", "motionOrEffectTrackCount",
    ], path, errors);
    if (id(routeValue.id, `${path}.id`, errors)) {
      if (routes.has(routeValue.id)) errors.push(`${path}.id must be unique`);
      else routes.set(routeValue.id, routeValue);
    }
    if (routeValue.role !== "content" && routeValue.role !== "shell") errors.push(`${path}.role is unsupported`);
    uniqueIds(routeValue.sceneIds, `${path}.sceneIds`, errors, 1);
    if (!GEOMETRY_SOURCES.has(routeValue.geometrySource as QualityLeapGeometrySource)) errors.push(`${path}.geometrySource is unsupported`);
    if (!SAMPLING_SOURCES.has(routeValue.samplingSource as QualityLeapSamplingSource)) errors.push(`${path}.samplingSource is unsupported`);
    if (!CONTOUR_TREATMENTS.has(routeValue.contourTreatment as QualityLeapContourTreatment)) errors.push(`${path}.contourTreatment is unsupported`);
    if (!VISIBILITY_EFFECT_POLICIES.has(routeValue.visibilityEffectPolicy as QualityLeapVisibilityEffectPolicy)) {
      errors.push(`${path}.visibilityEffectPolicy is unsupported`);
    }
    if (typeof routeValue.visibilityEffectComposited !== "boolean") errors.push(`${path}.visibilityEffectComposited must be boolean`);
    for (const key of ["targetPixelsPerSourcePixel", "edgeSupersampleFactor", "materialLayerCount", "authoredDetailCount", "motionOrEffectTrackCount"] as const) {
      nonNegativeInteger(routeValue[key], `${path}.${key}`, errors);
    }
    if (!Array.isArray(routeValue.qualityDimensions) || routeValue.qualityDimensions.length === 0) {
      errors.push(`${path}.qualityDimensions must be a non-empty array`);
    } else {
      const dimensions = new Set<string>();
      for (const [dimensionIndex, dimension] of routeValue.qualityDimensions.entries()) {
        if (!QUALITY_DIMENSIONS.has(dimension as QualityLeapDimension)) errors.push(`${path}.qualityDimensions[${dimensionIndex}] is unsupported`);
        else if (dimensions.has(dimension)) errors.push(`${path}.qualityDimensions[${dimensionIndex}] must be unique`);
        else dimensions.add(dimension);
      }
    }
  });

  const observedRoutes = new Set<string>();
  const sceneIds = new Set<string>();
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) errors.push("$.scenes must be a non-empty array");
  else value.scenes.forEach((sceneValue, index) => {
    const path = `$.scenes[${index}]`;
    if (!record(sceneValue)) { errors.push(`${path} must be an object`); return; }
    exactKeys(sceneValue, ["id", "observedContentRouteIds"], path, errors);
    if (id(sceneValue.id, `${path}.id`, errors)) {
      if (sceneIds.has(sceneValue.id)) errors.push(`${path}.id must be unique`); else sceneIds.add(sceneValue.id);
    }
    const contentIds = uniqueIds(sceneValue.observedContentRouteIds, `${path}.observedContentRouteIds`, errors,
      value.status === "accepted" ? 1 : 0);
    for (const routeId of contentIds) {
      observedRoutes.add(routeId);
      const route = routes.get(routeId);
      if (!route) errors.push(`${path}.observedContentRouteIds references missing route ${routeId}`);
      else {
        if (route.role !== "content") errors.push(`${path}.observedContentRouteIds must not count shell route ${routeId}`);
        if (typeof sceneValue.id === "string"
          && (!Array.isArray(route.sceneIds) || !route.sceneIds.includes(sceneValue.id))) {
          errors.push(`${path}.observedContentRouteIds route ${routeId} must declare scene ${sceneValue.id}`);
        }
      }
    }
  });

  const regressionCategories = new Set<QualityLeapRegressionCategory>();
  const regressionIds = new Set<string>();
  if (!Array.isArray(value.regressions)) errors.push("$.regressions must be an array");
  else value.regressions.forEach((regressionValue, index) => {
    const path = `$.regressions[${index}]`;
    if (!record(regressionValue)) { errors.push(`${path} must be an object`); return; }
    exactKeys(regressionValue, ["id", "category", "rejected"], path, errors);
    if (id(regressionValue.id, `${path}.id`, errors)) {
      if (regressionIds.has(regressionValue.id)) errors.push(`${path}.id must be unique`); else regressionIds.add(regressionValue.id);
    }
    if (!REQUIRED_REGRESSIONS.has(regressionValue.category as QualityLeapRegressionCategory)) errors.push(`${path}.category is unsupported`);
    else if (regressionCategories.has(regressionValue.category as QualityLeapRegressionCategory)) errors.push(`${path}.category must be unique`);
    else regressionCategories.add(regressionValue.category as QualityLeapRegressionCategory);
    if (regressionValue.rejected !== true) errors.push(`${path}.rejected must equal true`);
  });

  if (value.status === "accepted") {
    for (const [routeId, route] of routes) {
      if (route.role !== "content") continue;
      if (!observedRoutes.has(routeId)) errors.push(`$.routes content route ${routeId} is not observed by any scene`);
      qualityRouteErrors(route, `$.routes.${routeId}`, errors);
    }
    for (const category of REQUIRED_REGRESSIONS) {
      if (!regressionCategories.has(category)) errors.push(`$.regressions must include rejected ${category}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertQualityLeapAudit(value: unknown): asserts value is QualityLeapAuditV1 {
  const result = validateQualityLeapAudit(value);
  if (!result.ok) throw new TypeError(`Invalid quality-leap audit:\n${result.errors.join("\n")}`);
}
