// Turns a release (dist/index.html) + a variant into ad-network-ready files — no rebuild.
// Pure JS: runs in Node (playable/export/cli.js) and in the browser (a future Studio).

import { assetUsage, sanitizeOverrides } from "../kit/resolve.js";
import {
  PLACEHOLDERS,
  assetsBlock,
  configBlock,
  networkBlock,
  readAssets,
  readGameCode,
  readJson,
  replaceBlock,
  gameBlock,
  hasBlock
} from "../build/blocks.js";
import { EXPORT_NETWORKS } from "./networks.js";

function manifestFields(manifest) {
  return manifest.fields.map((f) => ({ aliases: [], ...f }));
}

/** Reads the editable schema and current values out of a release HTML. */
export function inspectRelease(html) {
  if (!hasBlock(html, "manifest")) throw new Error("no pl:manifest block — exported files can't be re-exported, use the release (dist/index.html)");
  const manifest = readJson(html, "manifest");
  return { manifest, overrides: readJson(html, "config"), assets: readAssets(html) };
}

function insertBefore(html, tag, text) {
  const i = tag === "</head>" ? html.indexOf(tag) : html.lastIndexOf(tag);
  if (i === -1) throw new Error(`${tag} not found`);
  return html.slice(0, i) + text + html.slice(i);
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const byteLength = (data) => (typeof data === "string" ? new TextEncoder().encode(data).length : data.length);

/**
 * @param html      release HTML (dist/index.html)
 * @param options.overrides  { path: value } — asset fields take an asset id
 * @param options.uploads    { assetId: { mime, base64 } } for ids that are not in the release
 * @param options.network    one of EXPORT_NETWORKS
 * @param options.language   forces options.language ("auto" keeps device detection)
 * @returns {{ files: Array<{ name, data }>, report }}
 */
export function exportVariant(html, { overrides = {}, uploads = {}, network = "default", language = null } = {}) {
  const net = EXPORT_NETWORKS[network];
  if (!net) throw new Error(`unknown network "${network}"`);

  const { manifest, overrides: embedded, assets: releaseAssets } = inspectRelease(html);
  const fields = manifestFields(manifest);

  const requested = { ...embedded, ...overrides };
  if (language) {
    const langField = fields.find((f) => f.type === "language");
    if (!langField) throw new Error("this playable has no language field");
    requested[langField.path] = language;
  }
  const { values, orphans, errors } = sanitizeOverrides(fields, requested);

  // ── assets ────────────────────────────────────────────────────────────
  const typeOfId = new Map();
  fields.forEach((f) => typeOfId.set(f.path in values ? values[f.path] : f.default, f.type));

  const { used, needed } = assetUsage(fields, values);
  const pruned = [];
  const missing = [];
  const assetList = [];
  for (const id of used) {
    const src = uploads[id] || releaseAssets.get(id);
    if (!src || (!src.base64 && !src.src)) {
      missing.push(id);
      continue;
    }
    const placeholder = !needed.has(id) && PLACEHOLDERS[typeOfId.get(id)];
    if (placeholder) pruned.push(id);
    assetList.push({ id, ...(placeholder || { mime: src.mime, base64: src.base64 }) });
  }
  if (missing.length) errors.push(...missing.map((id) => `asset "${id}" is neither in the release nor uploaded`));
  const removed = [...releaseAssets.keys()].filter((id) => !used.has(id));

  const files = [];
  let assetsHtml;
  if (net.assetFiles) {
    assetsHtml = assetsBlock(
      assetList.map(({ id, mime, base64 }) => {
        files.push({ name: `assets/${id}`, data: base64ToBytes(base64) });
        return { id, mime, src: `assets/${id}` };
      })
    );
  } else {
    assetsHtml = assetsBlock(assetList);
  }

  // ── html ──────────────────────────────────────────────────────────────
  let out = html;
  out = replaceBlock(out, "manifest", "");
  out = replaceBlock(out, "config", configBlock(values));
  out = replaceBlock(out, "assets", assetsHtml);
  out = replaceBlock(out, "network", networkBlock(network));

  let code = readGameCode(out);
  (net.replace || []).forEach(([search, replacement]) => {
    code = typeof search === "string" ? code.split(search).join(replacement) : code.replace(search, replacement);
  });
  if (net.inline === false) {
    out = replaceBlock(out, "game", `<script src="${net.script}"></script>`);
    files.push({ name: net.script, data: code });
  } else {
    out = replaceBlock(out, "game", gameBlock(code));
  }
  // Insert before the LAST </head> / </body>: the game code may contain those strings too.
  if (net.head) out = insertBefore(out, "</head>", net.head + "\n");
  if (net.bodyEnd) out = insertBefore(out, "</body>", net.bodyEnd + "\n");

  files.unshift({ name: net.htmlName || "index.html", data: out });
  Object.entries(net.extraFiles || {}).forEach(([name, data]) => files.push({ name, data }));

  const sizeBytes = files.reduce((n, f) => n + byteLength(f.data), 0);
  return {
    files,
    report: {
      network,
      language: values[fields.find((f) => f.type === "language")?.path] ?? null,
      sizeBytes,
      overLimit: net.maxMb ? sizeBytes > net.maxMb * 1024 * 1024 : false,
      maxMb: net.maxMb,
      applied: Object.keys(values).length,
      orphans,
      errors,
      pruned,
      removed
    }
  };
}
