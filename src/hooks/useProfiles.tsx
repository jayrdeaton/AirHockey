import AsyncStorage from '@react-native-async-storage/async-storage'
import { isSharedProfileStoreAvailable, loadSharedProfiles, Profile, saveSharedProfiles } from '@tastic/profile'
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { Player } from '@/types'
import { DEFAULT_LOCAL_PROFILES_STATE, isValidLocalProfilesState, LocalProfilesState } from '@/utils/profilesValidation'

const STORAGE_KEY = 'airhockey.profiles'
// Same group id BoxHockey and LightCycles both declare in app.json's ios.entitlements (and any
// future @tastic game that wants into the same shared roster) — see @tastic/profile's own README
// for why only the base identity fields travel through this.
const SHARED_GROUP_ID = 'group.com.infinitetoken.tastic'

interface CreateProfileInput {
  name: string
  color: string
  tag: string
}

interface ProfilesContextValue {
  profiles: Profile[]
  lastSelected: Record<Player, string | null>
  // False until the initial load below has fully resolved — both the local AsyncStorage read and,
  // when the shared App Group store is available, the shared-store read too (both must settle, not
  // just the local one, or a slower shared read would still land after something downstream has
  // already read a locally-loaded-but-not-yet-shared-reconciled roster). Exposed so _layout.tsx's
  // splash Gate can hold this provider's children back until real profile data exists rather than
  // the empty starting state — see splashGate.ts's 'profiles' gate.
  loaded: boolean
  createProfile: (input: CreateProfileInput) => Profile
  updateProfile: (id: string, patch: Partial<CreateProfileInput>) => void
  // Also clears lastSelected for any seat currently pointing at this id, so /loadout immediately
  // reflects Player (no profile) for that seat rather than a dangling id until next reload.
  deleteProfile: (id: string) => void
  selectProfile: (seat: Player, profileId: string | null) => void
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null)

interface Props {
  children: ReactNode
}

function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Single source of truth for saved player profiles, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx (expo-router keeps prior screens mounted, so a
// per-screen AsyncStorage-backed copy could go stale or clobber a concurrent update).
//
// Base identity fields (name/color/tag) are shared with every other @tastic game declaring the same
// App Group entitlement (see SHARED_GROUP_ID and @tastic/profile's own loadSharedProfiles/
// saveSharedProfiles) — create a profile in LightCycles, it shows up here too, and vice versa.
// Mirrors BoxHockey's/Pong's identically-shaped useProfiles.tsx — no per-seat extension field here
// either (AirHockey's paddle color is a shared theme setting, not part of a profile; see
// loadout.tsx), so `profiles` below is just `sharedBase` directly, unmodified.
// isSharedProfileStoreAvailable is false on Android/web and on any iOS build that hasn't run
// `expo prebuild` since the entitlement was added — `local.localBase` (only ever read/written in
// that case) keeps this screen fully usable there too, just without cross-app sharing.
export function ProfilesProvider({ children }: Props) {
  const [local, setLocal] = useState<LocalProfilesState>(DEFAULT_LOCAL_PROFILES_STATE)
  // null until the initial load below resolves — distinguishes "still loading" from "loaded, and
  // genuinely empty," which matters for the one-time seed-from-local migration in that same effect.
  const [sharedBase, setSharedBase] = useState<Profile[] | null>(null)
  const [loaded, setLoaded] = useState(false)
  // True for the duration of an in-flight saveSharedProfiles write — see persistBase and the
  // AppState foreground-reload effect below, which skips a refresh while this is true rather than
  // risk reading back a pre-write snapshot and reverting the change that's still landing.
  const pendingWriteRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let stored = DEFAULT_LOCAL_PROFILES_STATE
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (isValidLocalProfilesState(parsed)) stored = parsed
        }
      } catch {
        // Corrupt/stale blob or unavailable storage — DEFAULT_LOCAL_PROFILES_STATE is a complete,
        // silent fallback, same as useGameSettings.tsx.
      }
      if (cancelled) return
      setLocal(stored)

      if (!isSharedProfileStoreAvailable) {
        setSharedBase(stored.localBase)
        setLoaded(true)
        return
      }
      const shared = await loadSharedProfiles(SHARED_GROUP_ID)
      if (cancelled) return
      // First time this build has ever seen the shared store: seed it from whatever this app
      // already had saved locally, so an upgrading user's own profiles don't just vanish because
      // nothing's been written to the shared side yet. Only when the shared roster is still
      // completely empty — once ANYTHING has been shared (by this app or another), that always
      // wins over a stale local snapshot, never merged with it (avoids resurrecting a profile
      // deleted elsewhere).
      const seeded = shared.length === 0 && stored.localBase.length > 0 ? stored.localBase : shared
      if (seeded !== shared) saveSharedProfiles(SHARED_GROUP_ID, seeded).catch(() => {})
      setSharedBase(seeded)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The shared store doesn't push — @tastic/profile's sharedProfileStore.ts is a plain
  // UserDefaults(suiteName:) read/write with no cross-process change notification. Re-reading on
  // foreground is what catches "created/edited a profile in the other app, then switched back to
  // this one" — otherwise sharedBase only ever reflects what this app itself last wrote, until the
  // next cold start. Skipped while pendingWriteRef is still true: persistBase below never awaits
  // its own saveSharedProfiles call, so backgrounding right after a create/edit/delete and
  // foregrounding again before that write actually lands could otherwise read back a pre-write
  // snapshot here and silently revert it. This only ever skips one redundant refresh — the next
  // real foreground event, by which point the write has landed, reads correctly.
  useEffect(() => {
    if (!isSharedProfileStoreAvailable) return
    let cancelled = false
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || pendingWriteRef.current) return
      loadSharedProfiles(SHARED_GROUP_ID).then((shared) => {
        if (!cancelled) setSharedBase(shared)
      })
    })
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [])

  const persistLocal = useCallback((next: LocalProfilesState) => {
    setLocal(next)
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {})
  }, [])

  // Writes the base roster to whichever store is authoritative — the shared App Group roster when
  // available, this app's own local `localBase` fallback otherwise — and always updates the
  // in-memory sharedBase, which is the source for `profiles` below regardless of which backend it
  // actually came from. `extraLocalPatch` lets a caller fold another `local` change (e.g.
  // lastSelected) into the SAME persistLocal call as the `localBase` write below, rather than
  // issuing a second call that would spread the stale pre-update `local` closure and silently
  // revert this one (both calls would happen synchronously within one event handler, so `local`
  // never reflects the first call's setLocal by the time the second one reads it). saveSharedProfiles
  // itself never rejects (see @tastic/profile's own doc), so the trailing `.catch` below is just
  // defensive; pendingWriteRef is what the AppState foreground-reload effect above actually checks.
  const persistBase = useCallback(
    (next: Profile[], extraLocalPatch?: Partial<LocalProfilesState>) => {
      setSharedBase(next)
      if (isSharedProfileStoreAvailable) {
        pendingWriteRef.current = true
        saveSharedProfiles(SHARED_GROUP_ID, next)
          .catch(() => {})
          .finally(() => {
            pendingWriteRef.current = false
          })
        if (extraLocalPatch) persistLocal({ ...local, ...extraLocalPatch })
      } else {
        persistLocal({ ...local, localBase: next, ...extraLocalPatch })
      }
    },
    [local, persistLocal]
  )

  const createProfile = useCallback(
    (input: CreateProfileInput) => {
      const now = Date.now()
      const profile: Profile = { id: generateProfileId(), name: input.name, color: input.color, tag: input.tag, createdAt: now, updatedAt: now }
      persistBase([...(sharedBase ?? []), profile])
      return profile
    },
    [sharedBase, persistBase]
  )

  const updateProfile = useCallback(
    (id: string, patch: Partial<CreateProfileInput>) => {
      const base = sharedBase ?? []
      persistBase(base.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)))
    },
    [sharedBase, persistBase]
  )

  const deleteProfile = useCallback(
    (id: string) => {
      // Folded into the SAME persistBase call as the base-roster write via extraLocalPatch, rather
      // than a second, separate persistLocal call — see persistBase's own doc for why a second call
      // here would spread a stale `local` closure and silently revert this change.
      persistBase(
        (sharedBase ?? []).filter((p) => p.id !== id),
        {
          lastSelected: { 1: local.lastSelected[1] === id ? null : local.lastSelected[1], 2: local.lastSelected[2] === id ? null : local.lastSelected[2] }
        }
      )
    },
    [sharedBase, local, persistBase]
  )

  const selectProfile = useCallback(
    (seat: Player, profileId: string | null) => {
      persistLocal({ ...local, lastSelected: { ...local.lastSelected, [seat]: profileId } })
    },
    [local, persistLocal]
  )

  return <ProfilesContext.Provider value={{ profiles: sharedBase ?? [], lastSelected: local.lastSelected, loaded, createProfile, updateProfile, deleteProfile, selectProfile }}>{children}</ProfilesContext.Provider>
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext)
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider')
  return ctx
}
