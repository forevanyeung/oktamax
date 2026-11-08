/**
 * Stands in for @mediapipe/tasks-text, which @browser-ai/core imports for its embedding model.
 * The extension never embeds, and the real package loads scripts from a CDN: the Chrome Web
 * Store forbids code that isn't in the package, even code that never runs.
 */
export const TextEmbedder = {
  createFromOptions(): never {
    throw new Error('Text embedding is not included in Okta Max.');
  },
};
