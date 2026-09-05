import { isValidProfile, isValidTag, MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH, Profile } from '@tastic/profile'

import { Player } from '@/types'

// Pulled out of hooks/useProfiles.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — mirrors gameSettingsValidation.ts.
//
// AirHockey has no per-seat field to extend the package's base Profile type with (paddle color is
// a shared theme setting, not part of a profile — see loadout.tsx), so this just re-exports the
// package's own isValidProfile/isValidTag unmodified, same as Pong's version of this file.

export { isValidProfile, isValidTag, MAX_PROFILE_NAME_LENGTH, MAX_TAG_LENGTH }

// What this app persists locally. `localBase` is only read/written when the shared App Group
// store is unavailable (see isSharedProfileStoreAvailable in useProfiles.tsx) — this app's own
// complete fallback roster, in exactly the shape a solo (non-shared) install would use.
// `lastSelected` is always local — which profile P1/P2 last picked is naturally a per-app thing,
// not a cross-app one.
export interface LocalProfilesState {
  localBase: Profile[]
  lastSelected: Record<Player, string | null>
}

export const DEFAULT_LOCAL_PROFILES_STATE: LocalProfilesState = {
  localBase: [],
  lastSelected: { 1: null, 2: null }
}

function isValidSeatProfileId(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0)
}

function isValidLastSelected(value: unknown): value is Record<Player, string | null> {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Record<Player, string | null>>
  return isValidSeatProfileId(v[1]) && isValidSeatProfileId(v[2])
}

// All-or-nothing, matching gameSettingsValidation.ts's isValidSettings: one malformed entry
// anywhere invalidates the whole blob rather than silently dropping just that entry.
export function isValidLocalProfilesState(value: unknown): value is LocalProfilesState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<LocalProfilesState>
  return Array.isArray(v.localBase) && v.localBase.every(isValidProfile) && isValidLastSelected(v.lastSelected)
}
