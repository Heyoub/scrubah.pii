import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Configure HuggingFace Transformers for Node.js test environment
// Must be done before any imports that use transformers
import { env } from '@huggingface/transformers';

// Disable browser cache - not available in Node.js
env.useBrowserCache = false;
// Allow remote models to be downloaded
env.allowRemoteModels = true;
// Use local file cache instead of browser cache
env.cacheDir = './.cache/transformers';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock Intl.Segmenter for environments that don't support it
if (typeof Intl.Segmenter === 'undefined') {
  // @ts-ignore
  global.Intl.Segmenter = class Segmenter {
    constructor(_locale: string, _options: unknown) {}
    segment(text: string) {
      // Simple fallback: split by sentence-ending punctuation
      const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
      return sentences.map((segment: string) => ({ segment }));
    }
  };
}

// Mock crypto.randomUUID for deterministic tests
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  let idCounter = 0;
  global.crypto = {
    ...global.crypto,
    randomUUID: () => {
      idCounter++;
      return `test-uuid-${idCounter.toString().padStart(8, '0')}`;
    },
  } as Crypto;
}

// Polyfill File.prototype.text() for JSDOM
if (typeof File !== 'undefined' && !File.prototype.text) {
  File.prototype.text = async function() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(this);
    });
  };
}

// Polyfill File.prototype.arrayBuffer() for JSDOM
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = async function() {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(this);
    });
  };
}
