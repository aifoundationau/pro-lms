/**
 * Environment variables that work in the Vite browser build, Vite SSR (UI tests) and plain Node
 * (scripts and unit tests).
 *
 * Pass a function that reads `import.meta.env.VITE_NAME` literally: Vite replaces that expression
 * at build time. In plain Node `import.meta.env` is undefined, so the read throws, is caught, and
 * `process.env[name]` is used instead.
 */
export function readEnv(readViteValue, name) {
  let value;
  try {
    value = readViteValue();
  } catch {
    value = undefined;
  }
  if (value !== undefined && value !== null && value !== '') return value;
  if (name && typeof process !== 'undefined' && process.env) return process.env[name];
  return undefined;
}
