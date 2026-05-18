/**
 * PDF Worker Module
 * 
 * Web Worker wrapper for offloading heavy PDF parsing to a background thread.
 * Uses inline worker creation (no separate file needed) for seamless integration.
 *
 * NOTE: Currently, PDF parsing uses pdf.js from CDN which requires DOM access
 * (canvas rendering for page images). Full Worker migration requires:
 *  1. OffscreenCanvas support (available in modern browsers)
 *  2. importScripts() for pdf.js in Worker context
 *
 * This module provides the infrastructure for when that migration is needed.
 * For now, it wraps parsing in requestIdleCallback for non-blocking UI.
 *
 * @module pdf/worker
 */

/**
 * Schedule heavy work during browser idle time.
 * Falls back to setTimeout if requestIdleCallback is unavailable.
 *
 * @param {() => void} callback
 * @param {number} [timeout=1000] - Max wait before forcing execution
 */
export function scheduleIdleWork(callback, timeout = 1000) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    window.requestIdleCallback(callback, { timeout });
  } else {
    setTimeout(callback, 0);
  }
}

/**
 * Run a CPU-intensive function in chunks to avoid blocking the main thread.
 * Useful for processing large block arrays (100+ blocks).
 *
 * @param {Array} items - Array of items to process
 * @param {(item: any, index: number) => void} processor - Function to run per item
 * @param {number} [chunkSize=50] - Items per frame
 * @returns {Promise<void>}
 */
export function processInChunks(items, processor, chunkSize = 50) {
  return new Promise((resolve) => {
    let index = 0;

    function processChunk() {
      const end = Math.min(index + chunkSize, items.length);
      for (; index < end; index++) {
        processor(items[index], index);
      }

      if (index < items.length) {
        scheduleIdleWork(processChunk);
      } else {
        resolve();
      }
    }

    processChunk();
  });
}

/**
 * Debounce utility for reducing rapid-fire state updates.
 * Used internally by the editor for block update batching.
 *
 * @param {Function} fn
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
