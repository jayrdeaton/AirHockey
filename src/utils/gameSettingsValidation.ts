import { SCORE_TO_WIN } from '@/constants/game'
import { ControlScheme, GameSettings } from '@/types'

// Pulled out of hooks/useGameSettings.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — see useGameSettings.tsx's own import.
export const DEFAULT_SETTINGS: GameSettings = {
  gameMode: 'twoPlayer',
  scoreToWin: SCORE_TO_WIN,
  aiDifficulty: 'medium',
  lockOrientation: false,
  mapMode: 'rink',
  friction: 'medium',
  puckSize: 'medium',
  paddleSize: 'medium',
  deferBottomEdgeGestures: false,
  // Asymmetric defaults (not both 'mouse') so two seats sharing one desktop's keyboard/mouse don't
  // start out colliding — mirrors Snake's/Pong's identical reasoning for the same field.
  controlScheme: { 1: 'mouse', 2: 'wasd' }
}

function isValidControlScheme(value: unknown): value is ControlScheme {
  return value === 'mouse' || value === 'wasd' || value === 'arrows' || value === 'ijkl' || value === 'numpad'
}

export function isValidSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<GameSettings>
  return (v.gameMode === 'twoPlayer' || v.gameMode === 'vsCpu') && typeof v.scoreToWin === 'number' && (v.aiDifficulty === 'easy' || v.aiDifficulty === 'medium' || v.aiDifficulty === 'hard') && typeof v.lockOrientation === 'boolean' && v.mapMode === 'rink' && (v.friction === 'low' || v.friction === 'medium' || v.friction === 'high') && (v.puckSize === 'small' || v.puckSize === 'medium' || v.puckSize === 'large') && (v.paddleSize === 'small' || v.paddleSize === 'medium' || v.paddleSize === 'large') && typeof v.deferBottomEdgeGestures === 'boolean' && !!v.controlScheme && isValidControlScheme(v.controlScheme[1]) && isValidControlScheme(v.controlScheme[2])
}
