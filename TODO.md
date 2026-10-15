# TODO

Open fixes from the 2026-10-15 review of the 2026-10-08 fleet audit. Line numbers are as of that date. The F042, F094 and F010 fixes and `@tastic/profile` 0.12.0 landed on 2026-10-15, and F037 (device-wide unlocks on the winner's card only) with `@tastic/achievements` 0.6.0.

## Before launch

Nothing open: the 2026-10-15 live checks passed and keep-awake is in (see CLAUDE.md).

## After launch

1. **Android hardware back and web browser back skip "Quit Match?"** (audit F093). Needs hud support (an opt-in `BackHandler` in `useQuitConfirmation`, plus a router-level block for web). Before an Android release; iOS is unaffected.
2. **The Update Available prompt and toasts stay portrait while the screen is turned** (audit F007). The UpdateDialog wrapper passes no `rotation`, and the Toaster sits outside any turned frame. Pass `rotation`, or mount both in hud's `RotatedFrame`.
3. **Home's hero animation keeps looping under `/loadout` and `/game`** (audit F016). Pause it on blur and in the background, as Solitaire's HeroCards does (`useIsFocused` plus AppState).
4. **A loadout shared-setting dropdown can open toward the wrong edge during the panel-swap fade** (audit F225; from reading the code, not reproduced). Pass the `panelLayout` rotation to each shared-control trigger, as BoxHockey does.
