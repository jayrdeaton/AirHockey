import { configureStore } from '@reduxjs/toolkit'
import { type Profile, profilesReducer } from '@tastic/profile'
import { act, render } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import { Provider } from 'react-redux'

import { ProfilesProvider } from '@/hooks/useProfiles'
import profileSelection from '@/redux/profileSelectionSlice'

// A stand-in for the iOS App Group module @tastic/profile looks up at load time, so the real
// resolveInitialProfiles/useSharedProfilesSync run against a shared roster each test controls.
const mockSharedStore = new Map<string, string>()
jest.mock('expo-modules-core', () => {
  const actual = jest.requireActual('expo-modules-core')
  const native = {
    getSharedJSON: async (_groupId: string, key: string) => mockSharedStore.get(key) ?? null,
    setSharedJSON: async (_groupId: string, key: string, value: string) => {
      mockSharedStore.set(key, value)
    }
  }
  return { ...actual, requireOptionalNativeModule: (name: string) => (name === 'TasticProfile' ? native : actual.requireOptionalNativeModule(name)) }
})

const profile = (id: string): Profile => ({ id, name: id, color: '#ff0000', tag: '', createdAt: 0, updatedAt: 0 })
const alice = profile('alice')
const bob = profile('bob')

function setSharedRoster(roster: Profile[]) {
  mockSharedStore.set('sharedProfiles', JSON.stringify(roster))
}

async function mount(local: Profile[]) {
  const store = configureStore({ reducer: { profiles: profilesReducer, profileSelection }, preloadedState: { profiles: local, profileSelection: { 1: 'alice', 2: 'bob' } } })
  await render(
    <Provider store={store}>
      <ProfilesProvider>{null}</ProfilesProvider>
    </Provider>
  )
  await act(async () => {})
  return store
}

// Coming back to the foreground is when useSharedProfilesSync rereads the shared roster.
async function returnToForeground() {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls as [string, (state: AppStateStatus) => void][]
  const [, listener] = calls.filter(([type]) => type === 'change').at(-1)!
  await act(async () => listener('active'))
}

beforeEach(() => {
  mockSharedStore.clear()
  ;(AppState.addEventListener as jest.Mock).mockClear()
})

describe('ProfilesProvider', () => {
  // Regression: a seat kept pointing at a profile a sibling app had deleted, so its results were
  // recorded under an id no longer in the roster.
  it('clears a seat whose profile a sibling app deleted since this device last ran', async () => {
    setSharedRoster([alice])
    const store = await mount([alice, bob])
    expect(store.getState().profiles).toEqual([alice])
    expect(store.getState().profileSelection).toEqual({ 1: 'alice', 2: null })
  })

  it('clears a seat whose profile a sibling app deleted while this one was backgrounded', async () => {
    setSharedRoster([alice, bob])
    const store = await mount([alice, bob])
    expect(store.getState().profileSelection).toEqual({ 1: 'alice', 2: 'bob' })
    setSharedRoster([bob])
    await returnToForeground()
    expect(store.getState().profiles).toEqual([bob])
    expect(store.getState().profileSelection).toEqual({ 1: null, 2: 'bob' })
  })

  it('keeps the same selection object when every selected profile is still in the roster', async () => {
    setSharedRoster([alice, bob])
    const store = await mount([alice, bob])
    const before = store.getState().profileSelection
    setSharedRoster([alice, bob, profile('carol')])
    await returnToForeground()
    expect(store.getState().profiles).toHaveLength(3)
    expect(store.getState().profileSelection).toBe(before)
  })
})
