export function resolvePackageBaseUrl(
  configuredBase: string,
  documentBase: string | URL = document.baseURI,
): URL {
  const documentUrl = new URL(documentBase);
  const resolved = new URL(configuredBase, documentUrl);
  if (resolved.origin !== documentUrl.origin) {
    throw new Error(`Package base must share the document origin: ${resolved.href}`);
  }
  if (!resolved.pathname.endsWith("/")) resolved.pathname += "/";
  resolved.search = "";
  resolved.hash = "";
  return resolved;
}

function assertSafeRelativePath(relativePath: string): void {
  if (relativePath.length === 0 || relativePath.startsWith("/") || relativePath.startsWith("\\")
    || relativePath.includes("\\") || relativePath.includes("?") || relativePath.includes("#")) {
    throw new Error(`Package asset paths must be relative: ${relativePath}`);
  }

  for (const segment of relativePath.split("/")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Package asset path contains invalid encoding: ${relativePath}`);
    }
    if (segment.length === 0 || decoded === "." || decoded === ".."
      || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`Package asset path contains unsafe segments: ${relativePath}`);
    }
  }
}

function containedPackageUrl(packageBaseUrl: URL, relativePath: string, resolutionBase: URL): URL {
  assertSafeRelativePath(relativePath);
  const packageRoot = new URL(packageBaseUrl);
  if (!packageRoot.pathname.endsWith("/")) packageRoot.pathname += "/";
  packageRoot.search = "";
  packageRoot.hash = "";
  const resolved = new URL(relativePath, resolutionBase);
  if (resolved.origin !== packageRoot.origin || !resolved.pathname.startsWith(packageRoot.pathname)) {
    throw new Error(`Package asset path escapes its deployment base: ${relativePath}`);
  }
  return resolved;
}

export function resolvePackageAssetUrl(packageBaseUrl: URL, relativePath: string): URL {
  return containedPackageUrl(packageBaseUrl, relativePath, packageBaseUrl);
}

export function resolvePackageChildAssetUrl(
  packageBaseUrl: URL,
  manifestUrl: URL,
  relativePath: string,
): URL {
  const manifestDirectory = new URL(".", manifestUrl);
  return containedPackageUrl(packageBaseUrl, relativePath, manifestDirectory);
}
