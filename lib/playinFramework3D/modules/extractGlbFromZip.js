import { unzipSync } from "fflate";

/**
 * Extracts the first .glb file from a zip buffer and returns it as an ArrayBuffer.
 * Raw .glb bytes (no zip) are returned as they are, so a variant can upload either.
 * @param {ArrayBuffer} buffer - The zip (or glb) file as an ArrayBuffer.
 * @returns {Promise<ArrayBuffer|null>} - The .glb file's ArrayBuffer, or null if not found.
 */
export async function extractGlbFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  // "glTF" magic → already a binary glTF
  if (bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46) return buffer;
  const files = unzipSync(bytes, { filter: (file) => file.name.toLowerCase().endsWith(".glb") });
  const name = Object.keys(files)[0];
  if (!name) return null;
  const glb = files[name];
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}
