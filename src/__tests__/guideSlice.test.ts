import { createReturningPlayerMigrate, type GuideStorageReader } from '@tastic/hud/guide'

import { GUIDE_VERSION } from '@/constants/guide'
import reducer, { guideActions, LEGACY_STORAGE_KEYS, selectGuideVersionSeen } from '@/redux/guideSlice'

const REHYDRATE = 'persist/REHYDRATE'

function fakeStorage(entries: Record<string, string>): GuideStorageReader {
  return { getItem: (key) => Promise.resolve(entries[key] ?? null) }
}

// What redux-persist does on launch with no 'root' store (getStoredState gives undefined): run the
// persistConfig's migrate, then REHYDRATE with whatever it returned. -1 is redux-persist's default
// version, which store.ts doesn't override.
async function versionSeenAfterLaunch(entries: Record<string, string>) {
  const migrated = await createReturningPlayerMigrate(fakeStorage(entries), LEGACY_STORAGE_KEYS)(undefined, -1)
  return reducer(undefined, { type: REHYDRATE, key: 'root', payload: migrated }).versionSeen
}

// The factory's own behavior is covered in @tastic/hud's tests. This only pins this app's binding of
// it: GUIDE_VERSION is what an existing player is stamped with, the slice is mounted (and therefore
// rehydrated) under `guide` in the 'root'-keyed persisted store, and players from the shipped
// pre-redux build (a545f43) are recognized by the keys that build wrote.
describe('guideSlice', () => {
  it('starts as never seen when nothing is persisted under root, so the guide auto-shows on Home', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: undefined })
    expect(state.versionSeen).toBe(0)
  })

  it('stamps a player whose persisted store predates this slice with the current version, so an update never nags them', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: { theme: {}, profiles: {}, seatColors: {} } })
    expect(state.versionSeen).toBe(GUIDE_VERSION)
  })

  it('keeps a persisted version rather than re-stamping it', () => {
    const state = reducer(undefined, { type: REHYDRATE, key: 'root', payload: { theme: {}, guide: { versionSeen: GUIDE_VERSION } } })
    expect(state.versionSeen).toBe(GUIDE_VERSION)
  })

  it('records the version on finish or skip, and reads back from the root state under `guide`', () => {
    const state = reducer(undefined, guideActions.markSeen(GUIDE_VERSION))

    expect(state.versionSeen).toBe(GUIDE_VERSION)
    expect(selectGuideVersionSeen({ guide: state })).toBe(GUIDE_VERSION)
  })
})

describe('LEGACY_STORAGE_KEYS', () => {
  it("lists the shipped build's own keys, every one under this game's namespace", () => {
    expect(LEGACY_STORAGE_KEYS.length).toBeGreaterThan(0)
    for (const key of LEGACY_STORAGE_KEYS) expect(key).toMatch(/^airhockey\.[A-Za-z]+$/)
  })

  it('grandfathers a player from the shipped pre-redux build (no root store, one legacy key) and shows a fresh install the guide', async () => {
    expect(await versionSeenAfterLaunch({ 'airhockey.stats': '{}' })).toBe(GUIDE_VERSION)
    expect(await versionSeenAfterLaunch({})).toBe(0)
  })

  it('takes any single legacy key as proof, since each is written only by some players', async () => {
    for (const key of LEGACY_STORAGE_KEYS) expect(await versionSeenAfterLaunch({ [key]: '1' })).toBe(GUIDE_VERSION)
  })
})

// The real store, loaded fresh against the in-memory AsyncStorage mock (@infinitetoken/jest-config's
// default), so this also proves store.ts's persistConfig carries the migrate.
async function realStoreVersionSeen(entries: Record<string, string>) {
  let versionSeen = -1
  // require, not import(): Jest runs without --experimental-vm-modules, so a dynamic import throws.
  await jest.isolateModulesAsync(async () => {
    // The official mock is a plain CommonJS object with no `default`; store.ts's default import gets
    // that same object through Babel's interop.
    const mod = require('@react-native-async-storage/async-storage')
    const AsyncStorage: typeof import('@react-native-async-storage/async-storage').default = mod.default ?? mod
    await AsyncStorage.clear()
    await AsyncStorage.multiSet(Object.entries(entries))
    const { persistor, store } = require('@/redux/store') as typeof import('@/redux/store')
    await new Promise<void>((resolve) => {
      if (persistor.getState().bootstrapped) return resolve()
      const unsubscribe = persistor.subscribe(() => {
        if (!persistor.getState().bootstrapped) return
        unsubscribe()
        resolve()
      })
    })
    versionSeen = store.getState().guide.versionSeen
  })
  return versionSeen
}

describe('store persistConfig', () => {
  it('grandfathers a shipped-build player through the real store, and still shows a fresh install the guide', async () => {
    expect(await realStoreVersionSeen({ 'airhockey.settings': '{}' })).toBe(GUIDE_VERSION)
    expect(await realStoreVersionSeen({})).toBe(0)
  })
})
