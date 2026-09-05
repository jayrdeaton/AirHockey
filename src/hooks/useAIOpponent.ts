import { useEffect } from 'react'

import { BoardLayout, GameState, Player } from '@/types'
import { AIDifficulty, computeAIPaddleTarget } from '@/utils/aiOpponent'

// Re-runs every time state.puck changes — i.e. once per physics tick, since puck is a fresh
// object each TICK dispatch — so this hook itself IS the AI's per-tick decision point, riding
// the same cadence useGameState's own useGameLoop already drives rather than a separate rAF/
// interval loop of its own. `setPaddleTarget` is the EXACT SAME function TouchInputLayer's
// gesture callbacks call for a human — this is what preserves BoxHockey's "AI plays through the
// human's own input contract" principle at continuous granularity: the AI never touches
// PADDLE_TARGET dispatch, paddle velocity computation, or collision differently than a human's
// touch does, it only ever supplies a different SOURCE of target (x, y) coordinates.
export function useAIOpponent(state: GameState, board: BoardLayout, aiPlayer: Player | null, difficulty: AIDifficulty, paused: boolean, setPaddleTarget: (player: Player, x: number, y: number) => void): void {
  useEffect(() => {
    if (aiPlayer === null || paused || state.phase !== 'live') return
    const target = computeAIPaddleTarget(state.puck, state.paddles[aiPlayer], board, aiPlayer, difficulty)
    setPaddleTarget(aiPlayer, target.x, target.y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.puck, state.phase, aiPlayer, difficulty, paused, board, setPaddleTarget])
}
