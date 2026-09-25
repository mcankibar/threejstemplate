// Browser runtime: turns src/params.js + the data blocks embedded in the HTML into the gameConfig.
//
// The exported HTML carries its data in patchable blocks (written by the build, rewritten by the
// exporter — see playable/export/patch.js):
//   <script type="application/json" id="pl-config">{ ...override map... }</script>
//   <script type="text/plain" data-pl-asset="logo.png" data-mime="image/png">BASE64</script>
//   <script type="text/plain" data-pl-asset="logo.png" data-src="assets/logo.png"></script>  (path mode)
//
// Preview: a parent window (Studio / dev panel) sends { type: "pl:preview", overrides, assets }. The
// values are applied to the running game when possible (see "Live preview" below), otherwise the
// page reloads itself with those values. The values survive the reload in window.name, so this
// works in sandboxed iframes and without any storage permission.

import { collectFields, resolveConfig, sanitizeOverrides } from "./resolve.js";
import { ASSET_TYPES } from "./fields.js";
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

/** JSON data URIs become objects, text ones strings (ZIPs stay data URIs for their loaders). */
function decodeDataUri(uri) {
  const [head, body = ""] = uri.split(",");
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  if (/^data:application\/json/.test(head)) {
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("[playable] invalid JSON asset", e);
      return null;
    }
  }
  return text;
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
    const entry = { key: field.key || id, type: field.type };
    if (field.variant) entry.variant = field.variant;
    if (field.loader) entry.loader = field.loader;

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
    else if (field.type === "data" && !isZip) entry.data = decodeDataUri(dataUri);
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

  const previewAssets = (preview && preview.assets) || {};
  const entry = makeAssetEntry(collectAssetBlocks(), previewAssets);
  const { config, languages } = resolveConfig(definition, values, entry);
  live.state = { definition, fields, embedded, values, assets: previewAssets };

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
    if (msg.type === "pl:preview") updatePreview(msg.overrides || {}, msg.assets || {});
    else if (msg.type === "pl:reset") clearPreview();
  });
}

// ── Live preview ─────────────────────────────────────────────────────────────
// A preview change is applied to the running game when the game registered a handler
// (onLiveUpdate) and every changed field can be applied live. Otherwise the page restarts.
// A field restarts when it is marked { restart: true } (values the game only reads at start, such
// as a level layout), when it is an isEnabled switch or the language, or when it is a non-image
// asset (sounds, spines, atlases, fonts and models are decoded once at start).
// Images are applied live: the component reloads its textures and renders again.

const live = { state: null, handler: null, listeners: new Set() };

/**
 * Registers the function that applies a new config to the running game:
 *   handler({ config, changed: [path, ...], assets: { assetId: dataUri } }) → true when applied
 */
export function onLiveUpdate(handler) {
  live.handler = handler;
}

/** The definition currently in use (changes when src/params.js is hot-reloaded). */
export function getDefinition() {
  return live.state && live.state.definition;
}

/** Called with the new definition after src/params.js is hot-reloaded (dev panel). */
export function onDefinitionChange(listener) {
  live.listeners.add(listener);
  return () => live.listeners.delete(listener);
}

function needsRestart(field) {
  return (
    field.restart === true ||
    field.type === "language" ||
    // Components build (or skip) their objects once, based on isEnabled.
    /(^|\.)isEnabled$/.test(field.path) ||
    // Spine/atlas pages and non-image assets are decoded once, at start.
    !!field.loader ||
    (ASSET_TYPES.includes(field.type) && field.type !== "image")
  );
}

function changedPaths(fields, before, after, beforeFields = fields) {
  const previous = new Map(beforeFields.map((f) => [f.path, f]));
  return fields
    .filter((f) => {
      const old = previous.get(f.path);
      const a = f.path in before ? before[f.path] : old && old.default;
      const b = f.path in after ? after[f.path] : f.default;
      return JSON.stringify(a) !== JSON.stringify(b);
    })
    .map((f) => f.path);
}

function applyLive({ definition, fields, values, assets, changed }) {
  const byPath = new Map(fields.map((f) => [f.path, f]));
  if (!live.handler || changed.some((p) => needsRestart(byPath.get(p)))) return false;
  const blocks = collectAssetBlocks();
  // An image that is neither in the page nor uploaded (e.g. a new file named in params.js) needs
  // the page to be rebuilt by the dev server.
  const missing = changed.some((p) => {
    const field = byPath.get(p);
    const id = p in values ? values[p] : field.default;
    return ASSET_TYPES.includes(field.type) && !blocks.has(id) && !(id in assets);
  });
  if (missing) return false;
  const entry = makeAssetEntry(blocks, assets);
  const { config } = resolveConfig(definition, values, entry);
  try {
    if (live.handler({ config, changed, assets }) === false) return false;
  } catch (e) {
    console.error("[playable] live update failed, restarting", e);
    return false;
  }
  live.state = { ...live.state, definition, fields, values, assets };
  return true;
}

/**
 * Applies preview overrides/assets (assets: { id: dataUri }) to the running game, or restarts the
 * page with them when they cannot be applied live. Used by the dev panel and pl:preview messages.
 */
export function updatePreview(overrides = {}, assets = {}) {
  if (!previewEnabled()) return;
  const state = live.state;
  if (!state) return applyPreview(overrides, assets);
  // Keep the values for the next reload without reloading now.
  window.name = PREVIEW_PREFIX + JSON.stringify({ overrides, assets });
  const { values } = sanitizeOverrides(state.fields, { ...state.embedded, ...overrides });
  const changed = changedPaths(state.fields, state.values, values);
  if (!changed.length) return;
  if (!applyLive({ ...state, values, assets, changed })) window.location.reload();
}

/** Hot-reload of src/params.js: re-resolves the config with the new defaults. */
export function updateDefinition(definition) {
  const state = live.state;
  if (!previewEnabled() || !state) return window.location.reload();
  const fields = collectFields(definition);
  const paths = (list) =>
    list
      .map((f) => f.path)
      .sort()
      .join("\n");
  // Added/removed fields change the manifest and the embedded asset blocks: restart.
  if (paths(fields) !== paths(state.fields)) return window.location.reload();
  const { values } = sanitizeOverrides(fields, { ...state.embedded, ...(readPreviewState() || {}).overrides });
  const changed = changedPaths(fields, state.values, values, state.fields);
  if (changed.length && !applyLive({ ...state, definition, fields, values, changed })) return window.location.reload();
  live.state = { ...live.state, definition, fields };
  live.listeners.forEach((listener) => listener(definition));
}
