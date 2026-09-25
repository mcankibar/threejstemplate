import _ from "lodash-es";
/**
 * Shared utilities for all asset loaders.
 */

/**
 * Derives a key from a file path: "path/to/myAsset.glb" → "myAsset"
 */
export function keyFromFile(filePath) {
  return filePath.split("/").pop().split(".")[0];
}

/**
 * Returns the loadable src string for an asset entry.
 *   { data }      → returns the data string directly (base64 / data-URI)
 *   { file }      → "./prefix/file"
 *   { assetPath } → "./assets/assetPath"
 *   otherwise     → null
 */
export function getSrc(asset, prefix) {
  if (_.has(asset, "data")) return asset.data;
  if (_.has(asset, "file")) return `${prefix}/${asset.file}`;
  if (_.has(asset, "assetPath")) return `./assets/${asset.assetPath}`;
  return null;
}

/**
 * Schedules an asset load for a single component.
 *
 * sentSet  = shared (game-level) in-flight tracker
 * toLoadSet = per-component pending set
 *
 * Three cases:
 *  1. Already in loadedMap  → defer onAlreadyLoaded(key)
 *  2. Not in sentSet        → add to BOTH sets, defer doLoad (new load)
 *  3. In sentSet but not yet loaded (another component is loading it)
 *     → do NOT add to toLoadSet (the load will finish via the other component's
 *       callback), but start a fresh load so THIS component's handler fires too.
 *       Original behaviour: load again without adding to toLoadSet; when the
 *       callback fires, handler sees toLoadSet is empty → calls onComplete.
 *
 * Callbacks are deferred via queueMicrotask so the full forEach loop registers
 * all keys before any handler fires (prevents premature onComplete).
 */
export function scheduleLoad(key, loadedMap, sentSet, toLoadSet, doLoad, onAlreadyLoaded) {
  if (loadedMap.has(key)) {
    // Already cached — just tick the counter
    queueMicrotask(() => onAlreadyLoaded(key));
  } else if (!sentSet.has(key)) {
    // Brand new load — track in both sets
    sentSet.add(key);
    toLoadSet.add(key);
    queueMicrotask(() => doLoad(key));
  } else {
    // In-flight by another component — start a parallel load for this
    // component WITHOUT adding to toLoadSet.  When it completes the
    // handler will see toLoadSet.size === 0 and call onComplete.
    queueMicrotask(() => doLoad(key));
  }
}

/**
 * Call when a single asset finishes loading.
 * Removes the key from the tracking sets; fires onComplete when the queue empties.
 */
export function assetLoadHandler(key, toLoadSet, sentSet, onComplete) {
  sentSet.delete(key);
  toLoadSet.delete(key);
  if (toLoadSet.size === 0) {
    onComplete();
  }
}

/**
 * Marks an asset-type load as complete and triggers the component's
 * overall completion check.
 */
export function markLoadComplete(component, flagProp, label) {
  if (component[flagProp]) return; // already complete, ignore double-fire
  component[flagProp] = true;
  if (_.isNil(component.componentId)) {
    throw { message: "this component's componentId is nil", component };
  }
  console.debug(`[LOAD COMPLETE] ${component.componentId} : ${label} ✓`);
  component.checkAllLoadsCompleted();
}
