// Browser runtime: turns src/params.js + the data blocks embedded in the HTML into the gameConfig.
//
// The exported HTML carries its data in patchable blocks (written by the build, rewritten by the
// exporter — see playable/export/patch.js):
//   <script type="application/json" id="pl-config">{ ...override map... }</script>
//   <script type="text/plain" data-pl-asset="logo.png" data-mime="image/png">BASE64</script>
//   <script type="text/plain" data-pl-asset="logo.png" data-src="assets/logo.png"></script>  (path mode)
//
// Preview: a parent window (Studio / dev panel) sends { type: "pl:preview", overrides, assets } and
// the page reloads itself with those values. The values survive the reload in window.name, so this
// works in sandboxed iframes and without any storage permission.

import { collectFields, resolveConfig, sanitizeOverrides } from "./resolve.js";
import { getNetworkSettings } from "./networks.js";

const previewEnabled = () => window.__PL_MODE__ === "preview";

const PREVIEW_PREFIX = "pl-preview:";
const TRANSPARENT_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function readJsonBlock(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  try {
    return JSON.parse(el.textContent || "null");
  } catch (e) {
    console.error(`[playable] invalid JSON in #${id}`, e);
    return null;
  }
}

export function readPreviewState() {
  if (!previewEnabled()) return null;
  if (typeof window.name !== "string" || !window.name.startsWith(PREVIEW_PREFIX)) return null;
  try {
    return JSON.parse(window.name.slice(PREVIEW_PREFIX.length));
  } catch (e) {
    return null;
  }
}

/** Reloads the page with the given overrides/assets (assets: { id: dataUri }). */
export function applyPreview(overrides = {}, assets = {}) {
  if (!previewEnabled()) return;
  window.name = PREVIEW_PREFIX + JSON.stringify({ overrides, assets });
  window.location.reload();
}

export function clearPreview() {
  if (!previewEnabled()) return;
  window.name = "";
  window.location.reload();
}

function collectAssetBlocks() {
  const blocks = new Map();
  document.querySelectorAll("script[data-pl-asset]").forEach((el) => {
    blocks.set(el.getAttribute("data-pl-asset"), el);
  });
  return blocks;
}

function makeAssetEntry(blocks, previewAssets) {
  return (id, field) => {
    const entry = { key: id, type: field.type };
    if (field.variant) entry.variant = field.variant;

    let dataUri = previewAssets[id];
    const block = blocks.get(id);
    if (!dataUri && block && block.hasAttribute("data-src")) {
      // Path mode (e.g. TikTok): the file sits next to index.html; loaders prefix "./assets/".
      entry.assetPath = block.getAttribute("data-src").replace(/^\.?\/?assets\//, "");
      return entry;
    }
    if (!dataUri && block) {
      dataUri = `data:${block.getAttribute("data-mime")};base64,${block.textContent.trim()}`;
    }
    if (!dataUri) {
      console.error(`[playable] asset "${id}" (${field.path}) is missing from the HTML`);
      dataUri = field.type === "image" ? TRANSPARENT_PNG : "data:application/octet-stream;base64,";
    }

    const isZip = /\.zip$/i.test(id) || dataUri.startsWith("data:application/zip");
    if (field.type === "model" && isZip) entry.zipData = dataUri;
    else entry.data = dataUri;
    return entry;
  };
}

/**
 * @param definition the object exported by src/params.js
 * @returns {{ config, fields, languages, overrides, network, isPreview }}
 */
export function createRuntime(definition) {
  const preview = readPreviewState();
  const embedded = readJsonBlock("pl-config") || {};
  const raw = { ...embedded, ...(preview ? preview.overrides : {}) };

  const fields = collectFields(definition);
  const { values, orphans, errors } = sanitizeOverrides(fields, raw);
  if (orphans.length) console.warn("[playable] ignored unknown config paths:", orphans);
  if (errors.length) console.warn("[playable] ignored invalid values:", errors);

  const entry = makeAssetEntry(collectAssetBlocks(), (preview && preview.assets) || {});
  const { config, languages } = resolveConfig(definition, values, entry);

  listenForPreviewMessages();
  if (previewEnabled() && window.parent && window.parent !== window && window.location.origin !== "null") {
    window.parent.postMessage({ type: "pl:ready", overrides: values, languages }, window.location.origin);
  }

  return {
    config,
    fields,
    languages,
    overrides: values,
    network: getNetworkSettings(),
    isPreview: !!preview
  };
}

let listening = false;
function listenForPreviewMessages() {
  if (listening || !previewEnabled()) return;
  listening = true;
  window.addEventListener("message", (event) => {
    if (!previewEnabled() || event.source !== window.parent || event.source === window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    const token = window.__PL_PREVIEW_TOKEN__;
    const sameOrigin = event.origin !== "null" && event.origin === window.location.origin;
    const authenticated = typeof token === "string" && token.length >= 16 && msg.token === token;
    if (token ? !authenticated : !sameOrigin) return;
    if (msg.type === "pl:preview") applyPreview(msg.overrides || {}, msg.assets || {});
    else if (msg.type === "pl:reset") clearPreview();
  });
}
