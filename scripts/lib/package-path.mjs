import path from "node:path";

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

export function assertSafePackageRelativePath(value, label = "package path") {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
  if (value.includes("\\") || value.includes("%") || value.includes("?") || value.includes("#")) {
    throw new TypeError(`${label} must not contain escaped, encoded, query, or fragment syntax: ${value}`);
  }
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
    throw new TypeError(`${label} must be relative to the package root: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || !SEGMENT.test(segment))) {
    throw new TypeError(`${label} contains an unsafe path segment: ${value}`);
  }
  return value;
}

export function resolvePackageFile(packageRoot, relativePath, label = "package path") {
  const root = path.resolve(packageRoot);
  const safe = assertSafePackageRelativePath(relativePath, label);
  const resolved = path.resolve(root, ...safe.split("/"));
  if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) {
    throw new TypeError(`${label} escapes the package root: ${relativePath}`);
  }
  return resolved;
}
