// Public-directory files keep their Blender-relative paths. A content key lets
// browsers reuse unchanged images while fetching the model expected by this build.
const versions = typeof __SCENE_ASSET_VERSIONS__ === 'undefined' ? {} : __SCENE_ASSET_VERSIONS__;

export function sceneAssetUrl(path) {
  if (path.startsWith('blob:') || path.startsWith('data:')) return path;
  const base = new URL('.', document.baseURI);
  const url = new URL(path, base);
  const version = url.href.startsWith(base.href) && versions[url.pathname.slice(base.pathname.length)];
  if (version) url.searchParams.set('v', version);
  return url.href;
}
