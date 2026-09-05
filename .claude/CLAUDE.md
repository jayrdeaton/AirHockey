# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# AirHockey

A digital AirHockey game (Expo/React Native, Skia-rendered). Part of the `@rific`/`@tastic`/InfiniteToken app ecosystem — depends on `@rific/auto-paper`, `@rific/feedback-press`, `@rific/splash-gate`, `@rific/toaster`, `@rific/updater`, `@tastic/core`, `@tastic/hud`, `@tastic/input`, `@tastic/physics`, `@tastic/split-screen`.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code — don't rely on general Expo knowledge, this app is on SDK 57 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (4 suites, 54 tests)
npm run test:watch     # Jest --watchAll
npm run typecheck      # tsc
npm run verify         # lint + test + typecheck
npm run doctor         # expo install --fix && expo-doctor
npm start              # Expo dev server
npm run client          # Expo dev server (dev client build)
```

Always run `npm run lint` before finishing any task. This is an app (`"private": true`, no publish scripts) — `verify` doesn't include a build step.

`build:development`/`build:preview`/`build:production` and `update` (which `update:development`/`update:preview`/`update:production` delegate to) are each gated behind `verify` by prefixing `npm run verify && ` directly onto the script's own definition, same as every other migrated app — see Swirlio's CLAUDE.md for the full reasoning (not redundant with CI, since EAS builds/OTA updates have no GitHub Action step to catch this the way `publish.yml` does; inline chaining rather than a separate `pre<script>` hook, since these are scripts we author ourselves, not builtin npm commands).

## Tooling

Onboarded onto the shared `@infinitetoken` config packages (`eslint-config`, `jest-config`, `tsconfig`) — previously hand-rolled its own `eslint-config-expo`-based config, `jest-expo`-preset-direct config, and `expo/tsconfig.base`-extending tsconfig (the same pattern documented in [Swirlio](../Swirlio/.claude/CLAUDE.md)'s and [BoxHockey](../BoxHockey/.claude/CLAUDE.md)'s CLAUDE.md, which this migration followed almost mechanically — the hand-rolled shape was byte-for-byte the same boilerplate).

`npx expo install --fix` + `npm update` were run as part of this pass (`expo install --fix` genuinely found something — `expo-asset`/`expo-constants`/`expo-dev-client`/`expo-font`/`expo-haptics`/`expo-linking`/`expo-router`/`expo-screen-orientation`/`expo-system-ui`/`expo-updates`/`react-native`/`eslint-config-expo`/`jest-expo` were all a patch or two behind) — confirmed clean afterward: `npx expo install --check` reports up to date, `npm outdated` shows `Current === Wanted` for every dependency (remaining `Latest` values are all major bumps outside declared ranges, a deliberate-upgrade decision, not routine maintenance).

- `eslint.config.cjs` — `@infinitetoken/eslint-config/expo`, no local override (this app's old hand-rolled config restated `react-hooks/refs`/`react-hooks/immutability`/etc. as local `warn` rules that the shared preset already sets identically)
- `tsconfig.json` — `extends: "@infinitetoken/tsconfig/expo"`, keeps only the path-valued local bits (`paths`, `include`), plus the same two narrow `@shopify/react-native-skia` redirects Swirlio/BoxHockey/LightCycles needed (see below) — this app really does use `src/utils/loadSkiaWeb.web.ts` → `@shopify/react-native-skia/src/web`, confirmed by grep before copying the redirect forward, not assumed
- `jest.config.cjs` — `@infinitetoken/jest-config/expo`, no options at all — `jest.setup.cjs` and `roots` are both auto-detected/defaulted, and the old config's explicit `moduleNameMapper` (mirroring `tsconfig.json`'s `@/*` paths) is gone too, since the shared preset auto-derives it from `paths`

**`jest.config.ts` became `jest.config.cjs`, `tsconfig.json`'s `types` array was removed (now defaulted by the shared preset), and `prettier.config.js` was deleted in favor of `"prettier": "@infinitetoken/eslint-config/prettier"` in `package.json`** — all for the exact same reasons documented in BoxHockey's/Swirlio's CLAUDE.md; nothing app-specific here, see those for the full history (`ts-node`/`tsconfig.jest.json` gotchas, the prettier-config byte-for-byte-duplicate finding, the fleet-wide `types` drift investigation).

**`metro.config.js` was deleted — confirmed unmodified `getDefaultConfig(__dirname)` boilerplate** by removing it and running `npx expo export -p web` (builds clean, `canvaskit.wasm` still lands in `dist/`, same as every other Skia-using app in the fleet — see BoxHockey's CLAUDE.md for why Metro's `resolver.assetExts` is irrelevant to it).

**Native/Expo module mocks moved from inline `jest.mock()` calls in `jest.setup.cjs` into individual `src/__mocks__/*.ts` files** — `react-native-reanimated`, `react-native-worklets`, `@expo/vector-icons` (+ its `createIconSet` deep import), `expo-splash-screen`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-router`. Copied over verbatim from BoxHockey's own extracted mocks — this app's pre-migration `jest.setup.ts` had word-for-word identical mock factories (same shared boilerplate origin as every other game in the fleet), so there was nothing app-specific to reconcile. `jest.setup.cjs` now holds only genuine setup-file content (the `IS_REACT_ACT_ENVIRONMENT` flag, `unhandledRejection`/`uncaughtException` handlers, the RAF/cancelAnimationFrame polyfills, and the no-factory `NativeAnimatedHelper` automock) and is auto-detected by `@infinitetoken/jest-config/expo`. None of the current test suites (all pure-logic: `physics`, `useGameState`, `boardGeometry`, `aiOpponent`) actually exercise these mocks yet — same situation as Pong — but they're in place and ready the moment a component-rendering test is added.

**Migrating onto `@infinitetoken/tsconfig/expo` surfaced two real, new strictness findings** (this app's old tsconfig set `strict: true` itself but never turned on `noImplicitReturns`/`noUnusedLocals`/`noUnusedParameters`):
- `src/hooks/useGameState.ts`'s idle/goalScored-pause `useEffect` returned a cleanup function on one branch and implicitly fell through to `undefined` on the others — added an explicit `return undefined`, matching the fix pattern already used across CashierFu-Utility (`noImplicitReturns`, see its own CLAUDE.md).
- `src/utils/board.ts`'s private `buildGoalPosts` helper took a `width` parameter it never read (goal-post x-offsets come from `goalStart`/`goalEnd`, not `width`) — removed the parameter and its one call site's argument, same as BoxHockey's `outerBottom` dead-local removal.

**Migrating onto `typescript-eslint`'s `recommended` ruleset via the shared preset surfaced no new lint errors** — `npx eslint .` reports the same 9 `react-hooks/refs` warnings (0 errors) before and after the config swap, all the same "ref mirrors latest value for a callback/reducer to read" false-positive class documented in Swirlio's/BoxHockey's CLAUDE.md (`TouchInputLayer.tsx`'s gesture builders, `useGameState.ts`'s reducer/board refs) — pre-existing, not triaged/suppressed individually, same as BoxHockey left its own backlog.

`@infinitetoken/eslint-config` (`^0.2.0`), `@infinitetoken/jest-config` (`^0.2.3`), and `@infinitetoken/tsconfig` (`^0.4.1`) are all on real published versions — never yalc-linked for this app.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/expo`, `jest-expo` preset)
- Tests live in `src/__tests__/`
- Native/Expo module mocks live in `src/__mocks__/`, one file per module, picked up automatically (no `jest.mock()` call needed) — see Tooling above. None are exercised yet (only pure-logic tests exist); follow this convention from the start when a component-rendering test is added, don't reach for inline `jest.mock()` in `jest.setup.cjs`.
- `jest.setup.cjs` holds only genuine setup-file concerns: process-level error handlers, RAF polyfills, the `IS_REACT_ACT_ENVIRONMENT` flag, the no-factory `NativeAnimatedHelper` automock

## Architecture

```
src/
  app/          - expo-router routes
  components/   - UI components (board rendering, controls, dialogs)
  constants/    - static config, game/font params
  hooks/        - custom hooks (game state, AI opponent, sound, settings)
  types/        - shared TypeScript types
  utils/        - physics, board geometry, goal wedges, navigation, validation
  __tests__/    - test suites
  __mocks__/    - manual Jest mocks for native/Expo modules
```

## CI

`.github/workflows/ci.yml` uses the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-ci.yml@v1`, defaults to `npm run verify`) — previously a hand-rolled workflow running `npm ci && npm run ci`. The `ci` npm script was renamed to `verify` to match.
