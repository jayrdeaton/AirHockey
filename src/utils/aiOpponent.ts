import { MAX_PADDLE_SPEED } from '@/constants/game'
import { BoardLayout, PaddleState, Player, PuckState } from '@/types'
import { centerPaddle, clampToOwnHalf, playerGoalSide } from '@/utils/board'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

interface AITuning {
  // How far ahead (ms) the AI predicts the puck's straight-line position — no bounce-forward
  // simulation (unlike BoxHockey's planAIShot/simulateShot, which plans one whole shot in
  // advance): a short lookahead re-predicted fresh every tick approximates watch-and-adjust play,
  // which is both simpler and closer to how a real opponent actually defends than committing to a
  // pre-planned trajectory.
  interceptLookaheadMs: number
  // Random offset (px) applied to the AI's own computed target each tick — harder tiers see/aim
  // more precisely. Same "blur the choice by difficulty" idea as BoxHockey's aimNoiseDeg/
  // powerNoise, just applied to a position instead of an angle/power pair.
  aimJitterPx: number
  // Fraction of MAX_PADDLE_SPEED the AI's own target-approach rate is capped at. This alone is
  // what produces believable reaction lag: a low-tier AI's target is computed just as promptly as
  // a high-tier one's, it just physically can't get there as fast — no setTimeout scheduling
  // needed, unlike BoxHockey's randomAIThinkDelayMs.
  maxApproachSpeed: number
  // 0..1 — how strongly the AI eases back toward its own home position (centerPaddle) when the
  // puck isn't a threat, rather than snapping there instantly.
  defendHomeBiasWhenFar: number
}

const TUNING: Record<AIDifficulty, AITuning> = {
  easy: { interceptLookaheadMs: 80, aimJitterPx: 18, maxApproachSpeed: 0.55, defendHomeBiasWhenFar: 0.35 },
  medium: { interceptLookaheadMs: 140, aimJitterPx: 9, maxApproachSpeed: 0.75, defendHomeBiasWhenFar: 0.55 },
  hard: { interceptLookaheadMs: 200, aimJitterPx: 2, maxApproachSpeed: 0.95, defendHomeBiasWhenFar: 0.75 }
}

// dt=1 in @tastic/core's useGameLoop means "one nominal 60fps frame" (see computeClampedDt) —
// puck.vx/vy are already expressed per that same unit, so predicting `interceptLookaheadMs`
// ahead means converting it into the same frame-unit before scaling velocity by it.
const MS_PER_FRAME = 1000 / 60

// Pure, per-tick decision function — called once per physics tick for the AI's own seat (see
// useAIOpponent below) and returns a TARGET POSITION, exactly the shape a human's own drag
// produces (see TouchInputLayer's setPaddleTarget) — preserving BoxHockey's own "AI plays through
// the human's input contract" principle, just at continuous per-tick granularity instead of
// BoxHockey's one-shot gesture-script granularity.
export function computeAIPaddleTarget(puck: PuckState, ownPaddle: PaddleState, board: BoardLayout, aiPlayer: Player, difficulty: AIDifficulty, random: () => number = Math.random): { x: number; y: number } {
  const tuning = TUNING[difficulty]
  const side = playerGoalSide(aiPlayer)
  const lookaheadFrames = tuning.interceptLookaheadMs / MS_PER_FRAME
  const predicted = { x: puck.x + puck.vx * lookaheadFrames, y: puck.y + puck.vy * lookaheadFrames }

  // Threat gate: the puck is only worth chasing if it's on the AI's own half AND actually heading
  // toward the AI's own goal line — otherwise it's the opponent's shot to make, not this seat's.
  const onOwnHalf = side === 'bottom' ? puck.y > board.centerY : puck.y < board.centerY
  const movingTowardOwnGoal = side === 'bottom' ? puck.vy > 0 : puck.vy < 0
  const isThreat = onOwnHalf && movingTowardOwnGoal

  const home = centerPaddle(board, aiPlayer)
  let targetX: number
  let targetY: number
  if (isThreat) {
    targetX = predicted.x
    targetY = predicted.y
  } else {
    targetX = ownPaddle.x + (home.x - ownPaddle.x) * tuning.defendHomeBiasWhenFar
    targetY = ownPaddle.y + (home.y - ownPaddle.y) * tuning.defendHomeBiasWhenFar
  }

  const jitterAngle = random() * Math.PI * 2
  const jitterMag = random() * tuning.aimJitterPx
  targetX += Math.cos(jitterAngle) * jitterMag
  targetY += Math.sin(jitterAngle) * jitterMag

  const clamped = clampToOwnHalf(targetX, targetY, board, aiPlayer, board.paddleRadius)

  const maxStep = tuning.maxApproachSpeed * MAX_PADDLE_SPEED
  const dx = clamped.x - ownPaddle.x
  const dy = clamped.y - ownPaddle.y
  const dist = Math.hypot(dx, dy)
  if (dist <= maxStep || dist === 0) return clamped
  const scale = maxStep / dist
  return { x: ownPaddle.x + dx * scale, y: ownPaddle.y + dy * scale }
}
