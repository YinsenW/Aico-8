import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  HD_REVIEW_PACKET_SCHEMA_VERSION,
  HD_REVIEW_PRINCIPLE_GATES,
} from "../packages/contracts/src/hd-review-packet.ts";

const arguments_ = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  arguments_.set(key.slice(2), value);
}
const workspaceValue = arguments_.get("workspace");
assert.ok(workspaceValue, "--workspace is required");
const workspace = path.resolve(workspaceValue);
const write = arguments_.get("write") === "true";
const identityMapPath = path.join(workspace, "validation/hd-identity-map.json");
const browserEvidencePath = path.join(workspace, "evidence/browser-validation.json");
const documentPath = path.join(workspace, "evidence/identity-review-packet.html");
const packetPath = path.join(workspace, "evidence/identity-review-packet.json");
const decisionRelativePath = "evidence/identity-review-decision.json";
const decisionPath = path.join(workspace, decisionRelativePath);
const identityMap = JSON.parse(fs.readFileSync(identityMapPath, "utf8"));
const browser = JSON.parse(fs.readFileSync(browserEvidencePath, "utf8"));
assert.equal(typeof browser.subject, "string", "Browser evidence must name its review subject");
const reviewTitle = browser.subject.replace(/\s+private(?:\s|$).*$/i, "").trim();
assert.ok(reviewTitle, "Browser evidence subject must start with the game title");

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function sha256(file) {
  return sha256Bytes(fs.readFileSync(file));
}
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function list(items) {
  if (items.length === 0) return '<p class="none">Not applicable for this source element.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}
function imagePath(screenshot) {
  assert.ok(screenshot.path.startsWith("evidence/"), `${screenshot.id}: review image must be inside evidence`);
  return screenshot.path.slice("evidence/".length);
}

assert.equal(identityMap.canonicalReplayId, browser.validationReplay.replayId);
assert.equal(browser.identityReview.status, "pending-human-side-by-side-review",
  "Browser evidence records capture-time review state; the later decision is a separate immutable artifact");
assert.equal(browser.identityReview.accepted, false);
assert.equal(browser.identityReview.scenePairsComplete, true);
assert.equal(browser.identityReview.temporalComparisonsComplete, true);
const reviewerIds = new Set(identityMap.elements.map(({ review }) => review.reviewer));
assert.equal(reviewerIds.size, 1, "Every identity element must name the same reviewer");
const reviewer = [...reviewerIds][0];
const status = identityMap.status === "accepted" ? "accepted" : "pending-human-side-by-side-review";
const reviewDecision = status === "accepted"
  ? { path: decisionRelativePath, sha256: sha256(decisionPath) }
  : null;
const screenshotsById = new Map(browser.screenshots.map((screenshot) => [screenshot.id, screenshot]));
const screenshotIds = new Set();
for (const element of identityMap.elements) {
  element.review.sourceSceneIds.forEach((id) => screenshotIds.add(id));
  element.review.targetSceneIds.forEach((id) => screenshotIds.add(id));
}
for (const comparison of browser.sceneComparisons) {
  screenshotIds.add(comparison.sourceScreenshotId);
  screenshotIds.add(comparison.targetScreenshotId);
}
for (const comparison of browser.temporalComparisons) {
  for (const frame of comparison.frames) {
    screenshotIds.add(frame.sourceScreenshotId);
    screenshotIds.add(frame.targetScreenshotId);
  }
}
const screenshots = browser.screenshots.filter(({ id }) => screenshotIds.has(id));
assert.equal(screenshots.length, screenshotIds.size, "Review packet references an unknown screenshot");
for (const screenshot of screenshots) {
  const file = path.join(workspace, screenshot.path);
  assert.ok(file.startsWith(`${workspace}${path.sep}`), `${screenshot.id}: unsafe screenshot path`);
  assert.equal(sha256(file), screenshot.sha256, `${screenshot.id}: screenshot hash drift`);
  assert.equal(screenshot.visualRuntimeSha256, browser.build.visualRuntimeSha256,
    `${screenshot.id}: visual runtime drift`);
}

const elements = identityMap.elements.map((element) => ({
  id: element.id,
  kind: element.kind,
  semanticRole: element.semanticRole,
  sourceScreenshotIds: element.review.sourceSceneIds,
  targetScreenshotIds: element.review.targetSceneIds,
  criteria: {
    silhouetteTraits: element.anchors.silhouetteTraits,
    requiredParts: element.anchors.requiredParts.map((part) =>
      `${part.label}: recognize by ${part.recognitionCues.join("; ")}; reject ${part.forbiddenSubstitutions.join("; ")}`),
    proportionChecks: element.anchors.proportionChecks.map((check) =>
      `${check.label}: ${check.sourceRatio} → ${check.targetRatio}, maximum delta ${check.maximumAbsoluteDelta}`),
    compositionChecks: element.anchors.compositionChecks.map((check) => {
      const source = check.sourceBounds;
      const target = check.targetBounds;
      return `${check.label}: source [${source.x}, ${source.y}, ${source.width}, ${source.height}] → HD [${target.x}, ${target.y}, ${target.width}, ${target.height}], maximum edge delta ${check.maximumEdgeDelta}`;
    }),
    contourChecks: element.anchors.contourChecks.map((check) =>
      `${check.label}: exact projected mask ${check.sourceMaskSha256}; components ${check.sourceComponentCount} → ${check.targetComponentCount}; holes ${check.sourceHoleCount} → ${check.targetHoleCount}; maximum displacement ${check.measuredMaximumDisplacementSourcePixels}/${check.maximumDisplacementSourcePixels} source pixels`),
    faceAndExpressionTraits: element.anchors.faceAndExpressionTraits,
    colorHierarchy: element.anchors.colorHierarchy,
    motionCues: element.anchors.motionCues,
    gameplayCues: element.anchors.gameplayCues,
    forbiddenTransformations: element.anchors.forbiddenTransformations,
    allowedModernization: element.allowedModernization,
  },
  review: {
    reviewer: element.review.reviewer,
    silhouettePassed: element.review.silhouettePassed,
    requiredPartsPassed: element.review.requiredPartsPassed,
    proportionsPassed: element.review.proportionsPassed,
    contoursPassed: element.review.contoursPassed,
    expressionPassed: element.review.expressionPassed,
    colorHierarchyPassed: element.review.colorHierarchyPassed,
    motionPassed: element.review.motionPassed,
    gameplayCuesPassed: element.review.gameplayCuesPassed,
    visualGrammarPassed: element.review.visualGrammarPassed,
  },
}));

const principleGates = HD_REVIEW_PRINCIPLE_GATES.map((gate) => ({
  ...gate,
  verdict: status === "accepted" ? "passed" : "pending",
}));
const acceptancePhrase = `我已按顺序完成 ${reviewTitle} 当前构建的三重审查：神似还原、画质跃升、审美进化；确认前一项通过后才审查后一项，并同意全部 ${elements.length} 个源相对元素的身份、完整性、动画与视觉语法检查。`;

const packetWithoutDocument = {
  schemaVersion: HD_REVIEW_PACKET_SCHEMA_VERSION,
  gameId: identityMap.gameId,
  visualRuntimeSha256: browser.build.visualRuntimeSha256,
  replaySemanticsSha256: browser.validationReplay.semanticsSha256,
  identityMapSha256: sha256(identityMapPath),
  browserEvidenceSha256: sha256(browserEvidencePath),
  status,
  reviewer,
  acceptanceStatement: acceptancePhrase,
  principleGates,
  reviewDecision,
  elements,
  sceneComparisons: browser.sceneComparisons,
  temporalComparisons: browser.temporalComparisons,
  screenshots,
};

const screenshot = (id) => {
  const value = screenshotsById.get(id);
  assert.ok(value, `Unknown review screenshot ${id}`);
  return value;
};
const figure = (id, caption) => {
  const value = screenshot(id);
  const image = escapeHtml(imagePath(value));
  return `<figure><a class="zoom" href="${image}" target="_blank" rel="noopener"><img src="${image}" alt="${escapeHtml(`${value.presentationMode} ${value.sceneId} at ${value.stateBoundary}`)}"></a><figcaption>${escapeHtml(caption)} · open full size</figcaption></figure>`;
};
const staticSections = browser.sceneComparisons.map((comparison) => `
    <section class="comparison" id="static-${escapeHtml(comparison.id)}">
      <h3>${escapeHtml(comparison.id)} · ${escapeHtml(comparison.sceneId)}</h3>
      <div class="pair">
        ${figure(comparison.sourceScreenshotId, `SOURCE · ${screenshot(comparison.sourceScreenshotId).stateBoundary}`)}
        ${figure(comparison.targetScreenshotId, `HD · ${screenshot(comparison.targetScreenshotId).stateBoundary}`)}
      </div>
    </section>`).join("");
const temporalSections = browser.temporalComparisons.map((comparison) => `
    <section class="comparison" id="temporal-${escapeHtml(comparison.id)}">
      <h3>${escapeHtml(comparison.id)} · ${escapeHtml(comparison.sceneId)}</h3>
      <p class="elements">Elements: ${comparison.elementIds.map(escapeHtml).join(", ")}</p>
      <div class="timeline source-row"><strong>SOURCE</strong>${comparison.frames.map((frame) =>
        figure(frame.sourceScreenshotId, `u${frame.update} · ${frame.presentationMilliseconds} ms`)).join("")}</div>
      <div class="timeline hd-row"><strong>HD</strong>${comparison.frames.map((frame) =>
        figure(frame.targetScreenshotId, `u${frame.update} · ${frame.presentationMilliseconds} ms`)).join("")}</div>
    </section>`).join("");
const elementSections = elements.map((element) => {
  assert.equal(element.sourceScreenshotIds.length, element.targetScreenshotIds.length,
    `${element.id}: source/HD review anchors must pair one-for-one`);
  const anchors = element.sourceScreenshotIds.map((sourceId, index) => `
        <section class="anchor-pair">
          <h4>Review anchor ${index + 1} · ${escapeHtml(screenshot(sourceId).stateBoundary)}</h4>
          <div class="pair compact">
            ${figure(sourceId, "SOURCE REVIEW ANCHOR")}
            ${figure(element.targetScreenshotIds[index], "HD REVIEW ANCHOR")}
          </div>
        </section>`).join("");
  return `
    <article class="element" id="element-${escapeHtml(element.id)}">
      <div class="element-heading"><div><span class="kind">${escapeHtml(element.kind)}</span><h3>${escapeHtml(element.id)}</h3></div><span class="review-state">${status === "accepted" ? "ACCEPTED" : "PENDING HUMAN REVIEW"}</span></div>
      <p>${escapeHtml(element.semanticRole)}</p>
      <div class="anchor-list">${anchors}</div>
      <div class="criteria">
        <div><h4>Silhouette</h4>${list(element.criteria.silhouetteTraits)}</div>
        <div><h4>Required parts</h4>${list(element.criteria.requiredParts)}</div>
        <div><h4>Proportions</h4>${list(element.criteria.proportionChecks)}</div>
        <div><h4>Composition bounds</h4>${list(element.criteria.compositionChecks)}</div>
        <div><h4>Source contour lock</h4>${list(element.criteria.contourChecks)}</div>
        <div><h4>Face / expression</h4>${list(element.criteria.faceAndExpressionTraits)}</div>
        <div><h4>Color hierarchy</h4>${list(element.criteria.colorHierarchy)}</div>
        <div><h4>Motion</h4>${list(element.criteria.motionCues)}</div>
        <div><h4>Gameplay cues</h4>${list(element.criteria.gameplayCues)}</div>
        <div class="forbidden"><h4>Reject if</h4>${list(element.criteria.forbiddenTransformations)}</div>
      </div>
    </article>`;
}).join("");
const elementIndex = elements.map((element) =>
  `<a href="#element-${escapeHtml(element.id)}">${escapeHtml(element.id)}</a>`).join("");
const principleGateSections = principleGates.map((gate) => `
    <article class="principle-gate" data-verdict="${escapeHtml(gate.verdict)}">
      <span class="kind">GATE ${gate.order} · ${escapeHtml(gate.verdict.toUpperCase())}</span>
      <h3>${escapeHtml(gate.label)}</h3>
      ${list(gate.dimensions)}
    </article>`).join("");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="aico8-visual-runtime-sha256" content="${packetWithoutDocument.visualRuntimeSha256}">
  <title>${escapeHtml(reviewTitle)} · hash-bound HD identity review</title>
  <style>
    :root{color-scheme:dark;font:15px/1.45 Inter,system-ui,sans-serif;background:#080a12;color:#fff6ef}*{box-sizing:border-box}body{margin:0;padding:32px;background:radial-gradient(circle at top,#221326 0,#080a12 42rem)}main{max-width:1500px;margin:auto}h1{font-size:clamp(32px,6vw,72px);line-height:.95;margin:20px 0 16px}h2{margin:56px 0 18px;color:#ff92b7;font-size:30px}h3{margin:0 0 12px}.meta,.notice,.comparison,.element,.principle-gate{border:1px solid #4c3045;background:#11141f;border-radius:22px}.meta,.notice{padding:18px 22px;margin:16px 0}.notice{border-color:#956438;background:#271c18}.hash{font:12px ui-monospace,monospace;color:#c9bdcb;overflow-wrap:anywhere}.comparison,.element{padding:22px;margin:18px 0}.principle-gates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.principle-gate{padding:18px}.principle-gate[data-verdict="passed"]{border-color:#4f8d70}.pair{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pair.compact{max-width:1100px}.anchor-pair{margin:18px 0}.anchor-pair h4{color:#ffb0c9}.timeline{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:10px;align-items:start;margin:12px 0}.timeline strong{writing-mode:vertical-rl;padding:8px;color:#ff92b7}figure{margin:0;min-width:0}.zoom{display:block;cursor:zoom-in}img{display:block;width:100%;border-radius:12px;border:1px solid #3b3341;background:#05060a}figcaption{font:11px ui-monospace,monospace;color:#bdb2c3;margin-top:5px}.element-heading{display:flex;justify-content:space-between;gap:16px}.kind,.review-state{font:11px ui-monospace,monospace;letter-spacing:.08em;color:#ff92b7}.element-index{display:flex;flex-wrap:wrap;gap:8px}.element-index a,nav a{color:#ff92b7}.element-index a{border:1px solid #4c3045;border-radius:999px;padding:6px 10px;text-decoration:none}.criteria{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:18px}.criteria>div{padding:14px;border-radius:14px;background:#191b27}.criteria h4{margin:0 0 8px}.criteria ul{margin:0;padding-left:18px}.none{color:#8e8794;font-style:italic}.forbidden{border:1px solid #8d394a;background:#291820!important}.phrase{padding:18px;border-radius:14px;background:#0a0c13;font-size:17px}nav{display:flex;flex-wrap:wrap;gap:12px}@media(max-width:800px){body{padding:14px}.pair,.criteria,.principle-gates{grid-template-columns:1fr}.timeline{grid-auto-flow:row;grid-template-columns:1fr 1fr}.timeline strong{grid-column:1/-1;writing-mode:horizontal-tb}.element-heading{display:block}}
  </style>
</head>
<body><main>
  <p class="kind">AICO 8 · PRIVATE RESEARCH EVIDENCE</p>
  <h1>${escapeHtml(reviewTitle)}<br>HD identity review</h1>
  <div class="meta"><strong>Status: ${escapeHtml(status)}</strong><p class="hash">Visual runtime ${packetWithoutDocument.visualRuntimeSha256}<br>Replay semantics ${packetWithoutDocument.replaySemanticsSha256}<br>Identity map ${packetWithoutDocument.identityMapSha256}<br>Browser evidence ${packetWithoutDocument.browserEvidenceSha256}${reviewDecision ? `<br>Review decision ${reviewDecision.sha256}` : ""}</p></div>
  <div class="notice"><strong>This page is the judgment gate, not an automated approval.</strong> Each source/HD pair is bound to the same unchanged-cart replay state. Review the three non-compensatory gates in order, then the ${elements.length} source-relative element contracts; do not apply universal traits to unrelated games.</div>
  <nav><a href="#principles">3 principle gates</a><a href="#static">${browser.sceneComparisons.length} static pairs</a><a href="#temporal">${browser.temporalComparisons.length} animation/effect sequences</a><a href="#elements">${elements.length} element contracts</a><a href="#decision">Decision</a></nav>
  <h2 id="principles">Three ordered, non-compensatory gates</h2><div class="principle-gates">${principleGateSections}</div>
  <h2 id="static">${browser.sceneComparisons.length} same-state scene pairs</h2>${staticSections}
  <h2 id="temporal">${browser.temporalComparisons.length} exact-boundary temporal sequences</h2>${temporalSections}
  <h2 id="elements">${elements.length} source-relative element contracts</h2><nav class="element-index">${elementIndex}</nav>${elementSections}
  <h2 id="decision">Human decision</h2>
  <div class="notice"><p>Stop at the first failed gate. Accept only if Spirit fidelity passes before Quality leap, Quality leap passes before Aesthetic evolution, and every element preserves its declared identity, required parts, proportions, expression where applicable, color hierarchy, motion, gameplay cues, and shared visual grammar.</p><p>Reply with this exact sentence only after completing the ordered review:</p><p class="phrase">${escapeHtml(acceptancePhrase)}</p></div>
  <script>
    const only = new URLSearchParams(location.search).get("only");
    if (only) {
      const main = document.querySelector("main");
      const selected = document.getElementById(only);
      const label = main?.querySelector(":scope > .kind");
      const title = main?.querySelector(":scope > h1");
      const meta = main?.querySelector(":scope > .meta");
      if (main && selected && label && title && meta) {
        main.replaceChildren(label, title, meta, selected);
      }
    }
    history.scrollRestoration = "manual";
    scrollTo(0, 0);
  </script>
</main></body></html>\n`;

const packet = {
  ...packetWithoutDocument,
  document: {
    path: "evidence/identity-review-packet.html",
    sha256: sha256Bytes(html),
  },
};
const serializedPacket = `${JSON.stringify(packet, null, 2)}\n`;
if (write) {
  fs.writeFileSync(documentPath, html);
  fs.writeFileSync(packetPath, serializedPacket);
} else {
  assert.equal(fs.readFileSync(documentPath, "utf8"), html,
    "HD review document is stale; regenerate it from current evidence");
  assert.equal(fs.readFileSync(packetPath, "utf8"), serializedPacket,
    "HD review packet is stale; regenerate it from current evidence");
}
process.stdout.write(`HD review packet: ${write ? "generated" : "verified"} (${elements.length} elements, ${browser.sceneComparisons.length} static pairs, ${browser.temporalComparisons.length} temporal sequences, ${screenshots.length} screenshots)\n`);
