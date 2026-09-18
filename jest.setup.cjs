/* global jest */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// @rific/feedback-press/audio, @shopify/react-native-skia/src/web, and
// @expo/vector-icons/createIconSet used to be hand-registered jest.mock() calls here (a
// fleet-wide "known-offender deep subpath" gap every app independently rediscovered — Jest's
// manual src/__mocks__/ auto-pickup never matches a deep subpath import).
// @infinitetoken/jest-config/expo's `knownSubpathMocks` option (default true) now bakes all
// three in — see jest.config.cjs and that package's own README/CLAUDE.md.

const handleUnhandledRejection = (reason) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
}
