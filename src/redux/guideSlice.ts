import { createGuideSlice } from '@tastic/hud/guide'

import { GUIDE_VERSION } from '@/constants/guide'

// Thin binding over @tastic/hud/guide's createGuideSlice factory: the persisted "which version of the
// how-to-play flow has this player finished or skipped" flag. A fresh install starts at 0 (the guide
// auto-shows on Home); a player whose persisted 'root' store predates this slice is stamped with
// GUIDE_VERSION on their first rehydrate, so an over-the-air update never greets them with a "how to
// play" screen (see the factory's own doc for how it tells the two apart). Players updating from the
// shipped pre-redux build have no 'root' store at all; store.ts's persistConfig `migrate` hands them to
// this slice as existing players (see LEGACY_STORAGE_KEYS below). Mounted under `guide` in store.ts
// (that key is what the REHYDRATE payload is read from), and store.ts's persistConfig key is 'root',
// the factory's default persistKey, so neither option needs passing here.
const slice = createGuideSlice({ currentVersion: GUIDE_VERSION })

// The AsyncStorage keys the last shipped build wrote before this app had a redux-persist root store:
// a545f43 (otaVersion 3, 2026-09-05; otaVersion 1 and 2, e9ce0b1 and fe2901e, wrote the same set). The
// root store arrived in f66f539 (2026-09-15), so a player updating from that build has none of it, and
// any of these keys is what marks them as a returning player (createReturningPlayerMigrate, wired in
// store.ts). A historical record, deliberately literal rather than imported from today's code, so it
// can't change if a key is renamed later.
//
// The two stats keys come from @tastic/achievements@0.1.1's useAchievements, which builds
// `${namespace}.stats` and `${namespace}.achievements` from useGameStats' namespace 'airhockey'. That
// shipped useGameStats.tsx carried a comment claiming 'boxhockey.achievements' (a copy-paste leftover
// in the comment only); the published 0.1.1 build writes 'airhockey.achievements', so that's the key
// those devices actually have.
//
// The root store itself moved from persist:root to airhockey:root on 2026-10-19 (store.ts's keyPrefix:
// a colon, so it can never be one of these dotted keys). persist:root is deliberately not listed: no
// shipped build wrote it, and on the web it is the key every game on games.infinitetoken.com used to
// share, so finding it says nothing about this player having played AirHockey. These dotted keys stay
// safe on that shared origin: only the pre-redux native builds wrote them (AirHockey never had a web
// deployment before the root store), and today's AirHockey and Pong write none of them.
export const LEGACY_STORAGE_KEYS = [
  // Theme.tsx
  'airhockey.appearance',
  'airhockey.cpuColor',
  'airhockey.playerColors',
  // Feedback.tsx
  'airhockey.sound',
  'airhockey.vibrate',
  // useGameSettings.tsx
  'airhockey.settings',
  // useProfiles.tsx
  'airhockey.profiles',
  // useGameStats.tsx, through @tastic/achievements' useAchievements (see above)
  'airhockey.stats',
  'airhockey.achievements'
] as const

export const guideActions = slice.actions
export const selectGuideVersionSeen = slice.selectVersionSeen
export default slice.reducer
