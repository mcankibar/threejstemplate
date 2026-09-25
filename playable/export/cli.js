#!/usr/bin/env node
// Exports a release for ad networks, optionally with a variant — without rebuilding the game.
//
//   npm run export -- --variant variants/red-cta.json --networks applovin,unity --langs en,tr
//
// Variant file (JSON):
//   {
//     "name": "red-cta",
//     "overrides": {
//       "components.ctaButton1.localization.caption": { "en": "PLAY", "tr": "OYNA" },
//       "components.ctaButton1.assets.ctaButton": "file:red-cta.png"      ← relative to the variant file
//     },
//     "uploads": { "u/1a2b3c4d5e6f.png": "data:image/png;base64,..." }   ← optional, e.g. from the dev panel
//   }

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { exportVariant, inspectRelease } from "./patch.js";
import { EXPORT_NETWORK_NAMES } from "./networks.js";
import { mimeOf } from "../build/blocks.js";

function parseArgs(argv) {
  const args = { release: "dist/index.html", variants: [], networks: ["default"], langs: ["auto"], out: "exports" };
  for (const arg of argv) {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    const list = value.split(",").map((s) => s.trim()).filter(Boolean);
    if (key === "release") args.release = value;
    else if (key === "variant") args.variants.push(value);
    else if (key === "networks") args.networks = value === "all" ? EXPORT_NETWORK_NAMES : list;
    else if (key === "langs") args.langs = list;
    else if (key === "out") args.out = value;
    else if (key === "help" || key === "h") {
      console.log(`Usage: npm run export -- [--variant=file.json]... [--networks=a,b|all] [--langs=auto|en,tr] [--release=dist/index.html] [--out=exports]
Networks: ${EXPORT_NETWORK_NAMES.join(", ")}`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg} (use --key=value)`);
      process.exit(1);
    }
  }
  return args;
}

function parseDataUri(uri) {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(uri);
  if (!m) throw new Error("uploads must be base64 data URIs");
  return { mime: m[1], base64: m[2] };
}

function loadVariant(file) {
  if (!file) return { name: "default", overrides: {}, uploads: {} };
  const variant = JSON.parse(fs.readFileSync(file, "utf8"));
  const dir = path.dirname(file);
  const overrides = { ...(variant.overrides || {}) };
  const uploads = {};
  Object.entries(variant.uploads || {}).forEach(([id, uri]) => (uploads[id] = parseDataUri(uri)));

  // "file:relative/path.png" → content-addressed upload id
  Object.entries(overrides).forEach(([p, value]) => {
    if (typeof value !== "string" || !value.startsWith("file:")) return;
    const abs = path.resolve(dir, value.slice(5));
    const bytes = fs.readFileSync(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const id = `u/${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12)}.${ext}`;
    uploads[id] = { mime: mimeOf(abs), base64: bytes.toString("base64") };
    overrides[p] = id;
  });

  return { name: variant.name || path.basename(file, ".json"), overrides, uploads };
}

const slug = (s) => String(s).replace(/^@[^/]+\//, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + " MB";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.release)) {
    console.error(`Release not found: ${args.release} — run "npm run build" first.`);
    process.exit(1);
  }
  const html = fs.readFileSync(args.release, "utf8");
  const { manifest } = inspectRelease(html);
  const variants = (args.variants.length ? args.variants : [null]).map(loadVariant);
  fs.mkdirSync(args.out, { recursive: true });

  let failed = false;
  for (const variant of variants) {
    for (const network of args.networks) {
      for (const lang of args.langs) {
        const { files, report } = exportVariant(html, {
          overrides: variant.overrides,
          uploads: variant.uploads,
          network,
          language: lang
        });
        const base = [slug(manifest.game.id), slug(variant.name), network, lang].join("_");
        let outFile;
        if (files.length === 1) {
          outFile = path.join(args.out, `${base}.html`);
          fs.writeFileSync(outFile, files[0].data);
        } else {
          const entries = {};
          files.forEach((f) => (entries[f.name] = typeof f.data === "string" ? strToU8(f.data) : f.data));
          outFile = path.join(args.out, `${base}.zip`);
          fs.writeFileSync(outFile, zipSync(entries, { level: 9 }));
        }

        const size = fs.statSync(outFile).size;
        const flags = [];
        if (report.overLimit) flags.push(`OVER ${report.maxMb} MB LIMIT`);
        if (report.pruned.length) flags.push(`${report.pruned.length} disabled image(s) stripped`);
        if (report.orphans.length) flags.push(`ignored unknown paths: ${report.orphans.join(", ")}`);
        console.log(`${report.overLimit || report.errors.length ? "✗" : "✓"} ${outFile}  ${mb(size)}  ${report.applied} override(s)${flags.length ? "  — " + flags.join("; ") : ""}`);
        report.errors.forEach((e) => console.log(`    error: ${e}`));
        if (report.errors.length) failed = true;
      }
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
