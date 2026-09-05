import { applyFriction, boardCornerQuadrant, circleVsCircle, circleVsRect, circleVsRoundedCorner, reflectOffNormal } from '@tastic/physics'

import { FRICTION_LEVELS, MAX_PADDLE_SPEED, PADDLE_COLLISION_RESTITUTION, STOP_THRESHOLD, WALL_RESTITUTION } from '@/constants/game'
import { BoardLayout, PaddleState, PuckState } from '@/types'

export interface PhysicsResult extends PuckState {
  scored: 1 | 2 | null
  stopped: boolean
  bounced: boolean
  // Set only when this step's bounce was against the invisible one-way door at the goal mouth —
  // see the door collision block below. Ported from BoxHockey unchanged: distinguishes a door hit
  // from every other kind of bounce (wall/post/corner) so Board.tsx can flash just that side, only
  // on that specific hit, instead of on every generic bounce.
  goalDoorHit: 'top' | 'bottom' | null
}

function stepPhysicsOnce(puck: PuckState, board: BoardLayout, dt: number, friction: number): PhysicsResult {
  let { x, y, vx, vy } = puck

  const r = board.puckRadius
  const goalAbsLeft = board.x + board.goalStart
  const goalAbsRight = board.x + board.goalEnd
  // A puck already mid-crossing the front line at the START of this frame (leading edge already
  // past board.y/board.y+height, trailing edge not yet — scoring requires FULL clearance, by
  // design, so this is a real, reachable in-between state) skips friction this frame instead of
  // decaying normally. Without this, a puck that entered the goal mouth with only modest speed
  // could decay below STOP_THRESHOLD before its trailing edge ever cleared the line — at which
  // point nothing else acts on it there either (the flat wall is deliberately disabled for the
  // whole corridor once centerInGoalX is true), so it would simply sit there forever: not scored
  // (body not fully through) and not bounced back out. Skipping friction (rather than merely
  // exempting the `stopped` check) is what actually guarantees eventual full clearance.
  const centerInGoalX0 = x > goalAbsLeft && x < goalAbsRight
  const midCrossing = centerInGoalX0 && ((y - r < board.y && y + r >= board.y) || (y + r > board.y + board.height && y - r <= board.y + board.height))

  if (!midCrossing) {
    const frictioned = applyFriction({ x: vx, y: vy }, friction, dt)
    vx = frictioned.x
    vy = frictioned.y
  }

  x += vx * dt
  y += vy * dt

  // Center-only, deliberately lenient (vs. a full-body-clearance test): "within the goal's own
  // x-range" for every purpose that cares about it below — the flat-wall skip, the score check,
  // the goalpost collision gate, and the rink pocket's one-way door.
  const centerInGoalX = x > goalAbsLeft && x < goalAbsRight
  let bounced = false
  let goalDoorHit: 'top' | 'bottom' | null = null

  const wasBehindTop = puck.y + r < board.y
  const wasBehindBottom = puck.y - r > board.y + board.height

  // A puck that has ALREADY fully cleared the line this frame — BEFORE any corner/goalpost/wall
  // correction below ever touches it — is an unambiguous, already-complete score: return
  // immediately rather than risk a goalpost correction nudging the position back and un-scoring a
  // puck that had already made it all the way through.
  if (centerInGoalX && y + r < board.y && !wasBehindTop) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, goalDoorHit: null }
  if (centerInGoalX && y - r > board.y + board.height && !wasBehindBottom) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, goalDoorHit: null }

  // Near one of the 4 rounded outer corners, a single concave arc check replaces BOTH the flat
  // top/bottom and left/right wall checks below for this frame — this is also what opens the
  // wraparound path behind the goal, since within a corner's quadrant the flat front-wall check
  // (which would otherwise seal board.y everywhere outside the goal gap) simply doesn't run.
  const corner = boardCornerQuadrant(x, y, board)
  if (corner) {
    const col = circleVsRoundedCorner(x, y, r, corner.arcCenterX, corner.arcCenterY, board.cornerRadius)
    if (col.hit) {
      x = col.x
      y = col.y
      // col.nx/ny point OUTWARD from the arc center (toward the wall, away from the playable ice),
      // so a puck driving further into the wall has a velocity component ALONG that direction:
      // dot > 0 is the case to remove/reflect.
      const dot = vx * col.nx + vy * col.ny
      if (dot > 0) {
        vx -= (1 + WALL_RESTITUTION) * dot * col.nx
        vy -= (1 + WALL_RESTITUTION) * dot * col.ny
      }
      bounced = true
    }
  } else {
    // Checked BEFORE the flat wall below, and NOT gated on centerInGoalX at all — a post sits
    // EXACTLY at the corridor's own boundary, so circleVsCircle's own distance test is what
    // should decide this, not a same-threshold x-only proxy for it.
    let postHit = false
    for (const post of board.goalPosts) {
      const col = circleVsCircle({ position: { x, y }, radius: r }, { position: { x: post.x, y: post.y }, radius: post.radius })
      if (col.hit) {
        x += col.normal.x * col.depth
        y += col.normal.y * col.depth
        const reflected = reflectOffNormal({ x: vx, y: vy }, col.normal, WALL_RESTITUTION)
        vx = reflected.x
        vy = reflected.y
        bounced = true
        postHit = true
      }
    }

    // The TRUE outer boundary — board.y/board.height extended by board.behindGoalDepth. The gap
    // in this flat wall is governed by centerInGoalX (the same center-only threshold the score
    // check and the goalpost check above use): the posts are what actually make a wide-angle
    // approach to the goal mouth feel fair, so this flat wall only needs to get out of their way
    // once the puck's own center has genuinely entered the true goal opening, not before. The
    // wall stays solid across the FULL width outside the corners, including at the goal mouth
    // itself — the goal is a SLOT (a scoring position, not a wall opening), met only by the
    // posts/score-check, not by an actual gap in this boundary.
    const outerTop = board.y - board.behindGoalDepth
    const outerBottom = board.y + board.height + board.behindGoalDepth
    // Widens the near-line wall's own permeable zone in X to also exclude any post's real reach:
    // the post's max reach in x is puckRadius + postRadius, but only at the post's own y —
    // everywhere else its reach shrinks (a circle), while the wall's reach stays a constant
    // puckRadius regardless of x, so without this the wall can fire first at some x-offsets
    // instead of the post's own round shape.
    const nearPostX = board.goalPosts.some((post) => Math.abs(x - post.x) < r + post.radius)
    if (!postHit && y - r < outerTop && !centerInGoalX && !nearPostX) {
      y = outerTop + r
      vy = Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }

    if (!postHit && y + r > outerBottom && !centerInGoalX && !nearPostX) {
      y = outerBottom - r
      vy = -Math.abs(vy) * WALL_RESTITUTION
      bounced = true
    }
  }

  // A one-way door at the goal mouth. Open front-to-back — entering (whether it scores on a
  // fresh crossing or continues past into the pocket) is always unobstructed — but solid
  // back-to-front within the goal's own x-range specifically: a puck that's already behind the
  // line and drifts into the goal's x-range (e.g. wandering over from the wider pocket via a
  // corner) can't just pass back out through the same slot it would otherwise score through.
  // Clamped a hair past the exact line (not flush to it) — landing exactly at y0+r === board.y
  // would make wasBehindTop's own strict "<" comparison false on the VERY NEXT step, which let a
  // puck that just bounced off this door immediately satisfy the score condition's !wasBehindTop
  // check while still moving in the wrong direction.
  const DOOR_CLAMP_MARGIN = 1
  if (centerInGoalX && wasBehindTop && y + r >= board.y) {
    y = board.y - r - DOOR_CLAMP_MARGIN
    vy = -Math.abs(vy) * WALL_RESTITUTION
    bounced = true
    goalDoorHit = 'top'
  }
  if (centerInGoalX && wasBehindBottom && y - r <= board.y + board.height) {
    y = board.y + board.height + r + DOOR_CLAMP_MARGIN
    vy = Math.abs(vy) * WALL_RESTITUTION
    bounced = true
    goalDoorHit = 'bottom'
  }

  // Same check as the early return above, run again here: the one-way door just above can push a
  // puck that was behind the line back toward (or past) it, which the early check couldn't have
  // seen yet.
  if (centerInGoalX && y + r < board.y && !wasBehindTop) return { x, y, vx, vy, scored: 1, stopped: false, bounced: false, goalDoorHit: null }
  if (centerInGoalX && y - r > board.y + board.height && !wasBehindBottom) return { x, y, vx, vy, scored: 2, stopped: false, bounced: false, goalDoorHit: null }

  if (!corner) {
    if (x - r < board.x) {
      x = board.x + r
      vx = Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
    if (x + r > board.x + board.width) {
      x = board.x + board.width - r
      vx = -Math.abs(vx) * WALL_RESTITUTION
      bounced = true
    }
  }

  // Always empty (an open rink has no center divider) — kept so a future variant could add
  // obstacles without touching this loop, at zero runtime cost today.
  for (const obs of board.obstacles) {
    const col = circleVsRect({ position: { x, y }, radius: r }, obs)
    if (col.hit) {
      x += col.normal.x * col.depth
      y += col.normal.y * col.depth
      const reflected = reflectOffNormal({ x: vx, y: vy }, col.normal, WALL_RESTITUTION)
      vx = reflected.x
      vy = reflected.y
      bounced = true
    }
  }

  const stopped = Math.abs(vx) < STOP_THRESHOLD && Math.abs(vy) < STOP_THRESHOLD
  return { x, y, vx, vy, scored: null, stopped, bounced, goalDoorHit }
}

// How far a single stepPhysicsOnce call is allowed to move the puck before sub-stepping kicks in
// — tightened well below the smallest features these checks need to catch cleanly (a goalpost's
// radius) rather than bounded by puckRadius itself, so a trajectory drifting almost exactly along
// a goal-line boundary doesn't get sampled a hair on the wrong side of it. A fast paddle strike is
// exactly the kind of large single-frame velocity change this protects against, so it's MORE
// load-bearing here than in BoxHockey, where the puck only ever got a fresh velocity from a
// discrete drag-release, not a live per-frame paddle contact.
const SUBSTEP_MAX_DISPLACEMENT_RATIO = 0.15
const SUBSTEP_MAX_COUNT = 30

export function stepPhysics(puck: PuckState, board: BoardLayout, dt = 1, friction: number = FRICTION_LEVELS.medium): PhysicsResult {
  const speed = Math.hypot(puck.vx, puck.vy)
  const safeMaxDisplacement = board.puckRadius * SUBSTEP_MAX_DISPLACEMENT_RATIO
  const substeps = speed * dt > safeMaxDisplacement ? Math.min(SUBSTEP_MAX_COUNT, Math.ceil((speed * dt) / safeMaxDisplacement)) : 1
  if (substeps <= 1) return stepPhysicsOnce(puck, board, dt, friction)

  const subDt = dt / substeps
  let current = puck
  let anyBounced = false
  let lastGoalDoorHit: 'top' | 'bottom' | null = null
  for (let i = 0; i < substeps; i++) {
    const result = stepPhysicsOnce(current, board, subDt, friction)
    anyBounced = anyBounced || result.bounced
    lastGoalDoorHit = result.goalDoorHit ?? lastGoalDoorHit
    // A score or a stop is final — stop sub-stepping immediately rather than continuing to
    // integrate a puck that's already been removed from play (or come to rest) this frame.
    if (result.scored !== null || result.stopped) return { ...result, bounced: anyBounced, goalDoorHit: lastGoalDoorHit }
    current = { x: result.x, y: result.y, vx: result.vx, vy: result.vy }
  }
  return { ...current, scored: null, stopped: false, bounced: anyBounced, goalDoorHit: lastGoalDoorHit }
}

// A paddle's velocity, for collision purposes, is derived from how far its committed position
// moved THIS tick divided by dt — not from a gesture's own cumulative translation delta (which is
// relative to touch-down, not per-frame). Called once per player per physics tick (see
// useGameState.ts's TICK handler); the caller is expected to smooth this over a few ticks (see
// PADDLE_VELOCITY_SMOOTHING_FRAMES) before using it, so a single jittery touch sample doesn't
// read as a wild instantaneous velocity.
export function computePaddleVelocity(prevX: number, prevY: number, x: number, y: number, dt: number): { vx: number; vy: number } {
  if (dt <= 0) return { vx: 0, vy: 0 }
  return { vx: (x - prevX) / dt, vy: (y - prevY) / dt }
}

export function clampPaddleSpeed(vx: number, vy: number, maxSpeed: number = MAX_PADDLE_SPEED): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy)
  if (speed <= maxSpeed || speed === 0) return { vx, vy }
  const scale = maxSpeed / speed
  return { vx: vx * scale, vy: vy * scale }
}

// Live paddle-vs-puck collision — BoxHockey's paddle is purely decorative and never touches the
// physics engine at all; this is the one genuinely new collision primitive AirHockey needs.
//
// The paddle is treated as INFINITE MASS: its own vx/vy are never read back out of this function
// or modified by it — the live gesture in TouchInputLayer (or the AI) is the only thing that ever
// moves it, so a puck bouncing off it must never perturb next frame's finger-tracked position.
// @tastic/physics's resolveCircleCollision was considered and rejected for this: it's a
// SYMMETRIC, equal-mass exchange (verified by reading its source directly) that would also alter
// the paddle's own velocity — exactly the corruption this function exists to avoid.
//
// Instead this is the standard infinite-mass-vs-finite-mass elastic collision via a reference-
// frame shift, built from two already-exported, already-tested @tastic/physics primitives and no
// new physics math beyond the shift itself: transform into the paddle's own reference frame
// (subtract its velocity), reflect the puck's now-RELATIVE velocity off the contact normal
// exactly like reflectOffNormal already does against a stationary wall, then transform back (add
// the paddle's velocity back in). A fast-moving mallet imparts real velocity onto the puck (like
// a real strike, off a puck's own current motion); a paddle held still degenerates to an ordinary
// elastic wall bounce.
export function applyPaddleCollision(puck: PuckState, paddle: PaddleState, puckRadius: number, paddleRadius: number, restitution: number = PADDLE_COLLISION_RESTITUTION): PuckState {
  const col = circleVsCircle({ position: { x: puck.x, y: puck.y }, radius: puckRadius }, { position: { x: paddle.x, y: paddle.y }, radius: paddleRadius })
  if (!col.hit) return puck

  const x = puck.x + col.normal.x * col.depth
  const y = puck.y + col.normal.y * col.depth

  const relativeVelocity = { x: puck.vx - paddle.vx, y: puck.vy - paddle.vy }
  const reflected = reflectOffNormal(relativeVelocity, col.normal, restitution)

  return { x, y, vx: reflected.x + paddle.vx, vy: reflected.y + paddle.vy }
}
