import { createGameSettingsProvider } from '@tastic/core'

import { GameSettings } from '@/types'
import { DEFAULT_SETTINGS, isValidSettings } from '@/utils/gameSettingsValidation'

// Thin binding over @tastic/core's createGameSettingsProvider factory — this app's own
// GameSettingsProvider/useGameSettings pair (settings/setSettings/activeRoundSettings/
// commitRoundSettings/loaded/isActivelyPlaying/setIsActivelyPlaying, the useEdgeGestureGuard
// wiring, and the merge-onto-defaults-before-validating AsyncStorage load) was confirmed
// byte-for-byte identical to the factory's own implementation before this migration — nothing
// app-specific left behind. 'airhockey.settings' is this app's own real, unchanged STORAGE_KEY.
export const { GameSettingsProvider, useGameSettings } = createGameSettingsProvider<GameSettings>({
  storageKey: 'airhockey.settings',
  defaultSettings: DEFAULT_SETTINGS,
  isValidSettings
})
