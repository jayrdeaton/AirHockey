/* global jest */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Jest's manual __mocks__ auto-pickup doesn't reliably extend to deep subpath imports like this
// one, unlike a bare package mock — register it explicitly so src/__mocks__/@expo/vector-icons/
// createIconSet.ts actually gets used. See Hangman's jest.setup.cjs / Jest-Config's CLAUDE.md.
jest.mock('@expo/vector-icons/createIconSet')

// useGameSound.ts and Feedback.tsx both import this exact subpath directly
// (`@rific/feedback-press/audio`) — same asymmetry documented at length in Hangman's
// jest.setup.cjs: neither a bare `@rific/feedback-press` mock (there isn't one) nor any other
// subpath registration covers it, so it would load for real, completely unmocked, the moment a
// test reaches either file. A fleet-wide audit confirmed this specifier is currently dormant in
// this app (no existing test exercises useGameSound or Feedback), not live — registered now so it
// can never start silently loading real, unmocked audio-pooling code the moment a future test
// exercises that path. Same stub shape used identically for this exact package/subpath in
// Snake/Swirlio/Hangman/Pong; this app has no test analogous to Hangman's
// useClickSound.test.ts/usePopSound.test.ts that needs the real module, so no jest.requireActual
// carve-out is needed here.
jest.mock('@rific/feedback-press/audio', () => ({
  __esModule: true,
  useAudioPool: () => () => {}
}))

// loadSkiaWeb.web.ts imports this exact subpath directly (`@shopify/react-native-skia/src/web`)
// to fetch and initialize CanvasKit (a WASM build of Skia) at runtime. The package has no
// `exports` map restricting subpaths, so this resolves straight to the installed
// src/web/index.ts, which re-exports LoadSkiaWeb from src/web/LoadSkiaWeb.tsx — a real async
// function that fetches a WASM binary and assigns `global.CanvasKit`, with no guard against
// running outside a real browser/web environment. A fleet-wide audit confirmed this specifier is
// currently dormant in this app (BoardHost.web.tsx only reaches it via a dynamic
// `import('./Board')` behind `loadSkiaWeb()`, and no current test renders BoardHost.web or
// Board), not live — registered now so it can never start silently loading the real WASM-fetching
// module the moment a future test exercises that path. Stub matches LoadSkiaWeb's real shape: an
// async function resolving to undefined, same as loadSkiaWeb.web.ts's own no-op native
// counterpart (loadSkiaWeb.ts) already does.
jest.mock('@shopify/react-native-skia/src/web', () => ({
  __esModule: true,
  LoadSkiaWeb: () => Promise.resolve()
}))

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
