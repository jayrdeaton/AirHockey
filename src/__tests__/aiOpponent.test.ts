import { MAX_PADDLE_SPEED } from '@/constants/game'
import { computeAIPaddleTarget } from '@/utils/aiOpponent'
import { centerPaddle, computeBoardLayout } from '@/utils/board'

const insets = { top: 0, bottom: 0, left: 0, right: 0 }
const board = computeBoardLayout(400, 900, insets, 'vertical', 'medium')

const noJitter = () => 0 // jitterMag = random() * aimJitterPx = 0

describe('computeAIPaddleTarget — threat gate', () => {
  it('chases a puck on its own half moving toward its own goal (player 2 defends top)', () => {
    // Offset derived from paddleRadius (not a fixed pixel count) so this stays clear of the
    // near-goal clamp band (clampToOwnHalf's minY = board.y + paddleRadius) regardless of paddle
    // size — too close in and the predicted-position target legitimately overshoots past the
    // puck's CURRENT position while still correctly chasing its PREDICTED one, which this
    // assertion (measured against the current position) isn't meant to exercise.
    const puck = { x: board.centerX, y: board.y + board.paddleRadius * 5, vx: 0, vy: -3 } // on P2's half, heading further into it
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', noJitter)
    // Should move toward the puck's predicted position, not stay at (or retreat toward) home.
    const distToPuckBefore = Math.hypot(ownPaddle.x - puck.x, ownPaddle.y - puck.y)
    const distToPuckAfter = Math.hypot(target.x - puck.x, target.y - puck.y)
    expect(distToPuckAfter).toBeLessThan(distToPuckBefore)
  })

  it('retreats toward home when the puck is on its own half but moving AWAY (toward the opponent)', () => {
    const puck = { x: board.centerX, y: board.y + 40, vx: 0, vy: 5 } // on P2's half, but heading toward P1
    const ownPaddle = { x: board.centerX + 60, y: board.y + 100, vx: 0, vy: 0 } // off its home spot
    const home = centerPaddle(board, 2)
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', noJitter)
    const distToHomeBefore = Math.hypot(ownPaddle.x - home.x, ownPaddle.y - home.y)
    const distToHomeAfter = Math.hypot(target.x - home.x, target.y - home.y)
    expect(distToHomeAfter).toBeLessThan(distToHomeBefore)
  })

  it('retreats toward home when the puck is entirely on the opponent half', () => {
    const puck = { x: board.centerX, y: board.y + board.height - 40, vx: 0, vy: -8 } // deep on P1's half
    const ownPaddle = { x: board.centerX + 60, y: board.y + 100, vx: 0, vy: 0 }
    const home = centerPaddle(board, 2)
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', noJitter)
    const distToHomeBefore = Math.hypot(ownPaddle.x - home.x, ownPaddle.y - home.y)
    const distToHomeAfter = Math.hypot(target.x - home.x, target.y - home.y)
    expect(distToHomeAfter).toBeLessThan(distToHomeBefore)
  })
})

describe('computeAIPaddleTarget — difficulty tiers', () => {
  it('a harder difficulty jitters its target less than an easier one, for the same raw random draw', () => {
    const puck = { x: board.centerX, y: board.y + 40, vx: 0, vy: -3 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const maxJitter = () => 1 // jitterMag = 1 * aimJitterPx = full jitter
    const baseline = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', noJitter)
    const easyJittered = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'easy', maxJitter)
    const hardJittered = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', maxJitter)
    const easyOffset = Math.hypot(easyJittered.x - baseline.x, easyJittered.y - baseline.y)
    const hardOffset = Math.hypot(hardJittered.x - baseline.x, hardJittered.y - baseline.y)
    expect(hardOffset).toBeLessThan(easyOffset)
  })

  it('a harder difficulty approaches its target faster than an easier one, when both are far from it', () => {
    const puck = { x: board.centerX + board.width * 0.3, y: board.y + 20, vx: 0, vy: -1 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 } // far from the puck's own corner
    const easyTarget = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'easy', noJitter)
    const hardTarget = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'hard', noJitter)
    const easyStep = Math.hypot(easyTarget.x - ownPaddle.x, easyTarget.y - ownPaddle.y)
    const hardStep = Math.hypot(hardTarget.x - ownPaddle.x, hardTarget.y - ownPaddle.y)
    expect(hardStep).toBeGreaterThan(easyStep)
  })
})

describe('computeAIPaddleTarget — clamping', () => {
  it('never returns a target that crosses the centerline, regardless of jitter', () => {
    const puck = { x: board.centerX, y: board.y + 5, vx: 0, vy: -5 }
    const ownPaddle = { ...centerPaddle(board, 2), vx: 0, vy: 0 }
    const alwaysMaxJitter = () => 1
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'easy', alwaysMaxJitter)
    expect(target.y).toBeLessThanOrEqual(board.centerY)
  })

  it("the per-tick step is bounded by the difficulty's own maxApproachSpeed fraction of MAX_PADDLE_SPEED", () => {
    // Puck far across the board from the paddle's current position, so the raw (pre-clamp) target
    // distance is large — the rate-of-approach clamp must be what actually limits the step.
    const puck = { x: board.x + board.width * 0.9, y: board.y + 10, vx: 0, vy: -2 }
    const ownPaddle = { x: board.x + board.width * 0.1, y: board.y + board.height * 0.4, vx: 0, vy: 0 }
    const target = computeAIPaddleTarget(puck, ownPaddle, board, 2, 'medium', noJitter)
    const step = Math.hypot(target.x - ownPaddle.x, target.y - ownPaddle.y)
    expect(step).toBeLessThanOrEqual(MAX_PADDLE_SPEED + 0.01)
  })
})
