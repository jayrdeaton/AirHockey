import { createSettingsSlice } from '@rific/core'

import { SCORE_TO_WIN } from '@/constants/game'
import type { Settings } from '@/types'

// The persisted settings: a Redux slice like every other persisted value in this app, read and
// written only through hooks/useSettings.ts. Built on @rific/core's createSettingsSlice: `initialize`
// in 'merge' mode is the single write path (setSettings' partial patch), and its REHYDRATE handling
// fills any field added after a player's settings were saved from DEFAULT_SETTINGS, so no
// validation or migration is needed.
export const DEFAULT_SETTINGS: Settings = {
  gameMode: 'twoPlayer',
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  lockOrientation: false,
  friction: 'medium',
  puckSize: 'medium',
  paddleSize: 'medium',
  // On by default - see its own doc comment on Settings.
  rink: true,
  deferBottomEdgeGestures: false,
  keepAwake: true,
  // Asymmetric defaults (not both 'mouse') so two seats sharing one desktop's keyboard/mouse don't
  // start out colliding - mirrors Snake's/Pong's identical reasoning for the same field.
  controlScheme: { 1: 'mouse', 2: 'wasd' }
}

const { actions, reducer } = createSettingsSlice<Settings, 'merge', never>('settings', {
  initialState: DEFAULT_SETTINGS,
  initializeMode: 'merge',
  fieldSetters: []
})

export const settingsActions = actions
export default reducer
