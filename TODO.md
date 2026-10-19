# TODO

Open fixes from the 2026-10-15 review of the 2026-10-08 fleet audit. Line numbers are as of that date. The F042, F094 and F010 fixes and `@tastic/profile` 0.12.0 landed on 2026-10-15, and F037 (device-wide unlocks on the winner's card only) with `@tastic/achievements` 0.6.0.

## Before launch

Nothing open: the 2026-10-15 live checks passed and keep-awake is in (see CLAUDE.md).

## After launch

1. **Android hardware back and web browser back skip "Quit Match?"** (audit F093). Needs hud support (an opt-in `BackHandler` in `useQuitConfirmation`, plus a router-level block for web). Before an Android release; iOS is unaffected.
2. **The Update Available prompt and toasts stay portrait while the screen is turned** (audit F007). The UpdateDialog wrapper passes no `rotation`, and the Toaster sits outside any turned frame. Pass `rotation`, or mount both in hud's `RotatedFrame`.
3. **Home's hero animation keeps looping under `/loadout` and `/game`** (audit F016). Pause it on blur and in the background, as Solitaire's HeroCards does (`useIsFocused` plus AppState).
4. **A loadout shared-setting dropdown can open toward the wrong edge during the panel-swap fade** (audit F225; from reading the code, not reproduced). Pass the `panelLayout` rotation to each shared-control trigger, as BoxHockey does.

## Expo SDK 58 follow-ups (2026-10-18)

Deferred to ship SDK 58 the same day:

- **Check it on a device.** Verify, typecheck and the iOS prebuild config pass, but nothing ran on hardware or on web: launch (SDK 58's scene life cycle), swiping a toast away (`@rific/toaster` 0.9 builds its swipe with gesture-handler 3's deprecated `Gesture.Pan()`, and its tests mock gesture-handler), the paddle touch input (`TouchInputLayer.tsx`, the same deprecated builder), the board's Skia drawing (Skia 2.6 to 2.14) and the edge-gesture guard. The gitignored `ios/` and `android/` folders are an SDK 57 prebuild, so run `npx expo prebuild --clean` first.
- **React Native 0.88 strict types.** `@infinitetoken/tsconfig` 0.6 resolves React Native 0.88's legacy types, and React Native drops them after 0.88. Checked 2026-10-18 with `customConditions: ["react-native"]` only: this app's own code fails in 1 place (`src/components/Theme.tsx:52`, TS2322: `@react-native-masked-view/masked-view`'s `MaskedView` no longer fits `@rific/auto-paper`'s `MaskedViewModule` type, a `ComponentClass`, so the fix belongs in auto-paper), plus package source it type-checks (`@tastic/hud` 15, `@tastic/split-screen` 6, `@rific/auto-paper` 3, `@tastic/profile` 3, `@tastic/core` 1, `@rific/updater` 1). Fix those packages first (their TODO.md files), then drop the deferral.
- **Web tab title in the static HTML.** Since SDK 58, `expo-router/head`'s `<Head>` (in `src/components/Fonts.tsx`) only sets the title after hydration; the static export's HTML has none, so the tab shows the URL until the JS loads and crawlers see no title. Export `generateMetadata()` (returns `{ title }`) from each route, or from the root layout if Expo Router supports it there, then drop `<Head>`.
