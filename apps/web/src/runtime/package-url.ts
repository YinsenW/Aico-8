export function resolvePackageBaseUrl(
  configuredBase: string,
  documentBase: string | URL = document.baseURI,
): URL {
  const resolved = new URL(configuredBase, documentBase);
  if (!resolved.pathname.endsWith("/")) resolved.pathname += "/";
  return resolved;
}

export function resolvePackageAssetUrl(packageBaseUrl: URL, relativePath: string): URL {
  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
    throw new Error(`Package asset paths must be relative: ${relativePath}`);
  }
  return new URL(relativePath, packageBaseUrl);
}
