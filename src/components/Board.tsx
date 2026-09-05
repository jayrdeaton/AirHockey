import { useAutoPaperTheme } from '@rific/auto-paper'
import { Canvas, Circle, Group, Line, Path, Rect, Skia, vec } from '@shopify/react-native-skia'
import { FaceoffCircle, GoalDoorFlash, ScoreWedges, ZoneLine } from '@tastic/sprites/hockey'
import { CelebrationRings, Disc, GoalPost, ObstacleRect } from '@tastic/sprites/shapes'
import { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { cancelAnimation, Easing, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'

import { GOAL_LINE_STROKE_WIDTH } from '@/constants/game'
import { BoardLayout, GamePhase, GoalSide, PaddleStates, Player, PuckState } from '@/types'
import { faceoffZoneCenters, faceoffZoneRadius } from '@/utils/board'
import { computeGoalWedges } from '@/utils/goalWedges'

// Flip to true locally to see the rink pocket's true collision curve (rounded corners +
// behind-goal pocket) while tuning cornerRadius/behindGoalDepth in computeBoardLayout — off by
// default, matching BoxHockey's own verdict that the pocket reads better with nothing drawn there
// (the device's own physical screen edge is the only boundary a player ever needs to see).
const SHOW_RINK_DEBUG_PERIMETER = false

export interface BoardProps {
  board: BoardLayout
  puck: PuckState
  paddles: PaddleStates
  phase: GamePhase
  scores: [number, number]
  scoreToWin: number
  lastScoredGoal: GoalSide | null
  // Same "counter + kind" shape as useGameState's own bounceCount — bumped whenever the puck
  // struck the invisible one-way goal-mouth door (see physics.ts's goalDoorHit). Drives the
  // goal-door flash below; never resets between rounds, so that effect diffs against a ref rather
  // than expecting a return to 0.
  goalDoorHitCount: number
  lastGoalDoorSide: GoalSide | null
  // Perimeter walls (all four sides) — see game.tsx's isDesktopWeb. On a phone (native or mobile
  // web) they'd sit redundantly right against the device's own physical edge, which already reads
  // as the boundary; only desktop web, with no such edge, gets them.
  showWalls: boolean
}

export default function Board({ board, puck, paddles, phase, scores, scoreToWin, lastScoredGoal, goalDoorHitCount, lastGoalDoorSide, showWalls }: BoardProps) {
  const { x, y, width, height, wallThickness, puckRadius, paddleRadius, goalStart, goalEnd, obstacles, goalPosts } = board

  const goalAbsLeft = x + goalStart
  const goalAbsRight = x + goalEnd
  const goalCX = x + width / 2

  const { colors: themeColors, dark } = useAutoPaperTheme()

  // Retro-vector palette — same convention as BoxHockey/LightCycles: the board's own structure
  // (walls/goal lines) is a literal black/white-by-appearance neutral, not a themed color, since
  // it's scaffolding rather than a gameplay signal; a player's own puck/paddle/goal accents are
  // the only saturated color on screen.
  const wallColor = dark ? '#FFFFFF' : '#000000'
  const lineColor = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
  const centerLineColor = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // ─── Puck ring pulse ────────────────────────────────────────────────────────
  // A gentle "not live yet" breathe during the pre-game/post-goal pause — plain white and static
  // once play is actually live, unlike BoxHockey's per-player-colored idle ring (there's no
  // "whose turn" concept here to color it by).
  const waiting = phase !== 'live'
  const idlePulseT = useSharedValue(0)
  useEffect(() => {
    if (waiting) {
      idlePulseT.value = 0
      idlePulseT.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.sin) }), -1, true)
    } else {
      cancelAnimation(idlePulseT)
      idlePulseT.value = 0
    }
  }, [waiting]) // eslint-disable-line react-hooks/exhaustive-deps
  const ringOpacity = useDerivedValue(() => (waiting ? 0.55 + idlePulseT.value * 0.35 : 1))

  // ─── Goal crease / score arcs ──────────────────────────────────────────────
  // The crease doubles as the score meter — see computeGoalWedges' own doc comment. Player 1
  // always sits at the local bottom (see playerGoalSide in utils/board.ts), so p1's crease/wedges
  // are anchored at y+height/baseAngle 180, and p2's at y/baseAngle 0 — same convention BoxHockey
  // uses, ported unchanged.
  const goalCreaseRadius = board.goalWidth / 2

  const p1CreaseFill = useMemo(() => {
    const r = goalCreaseRadius
    return Skia.PathBuilder.Make()
      .addArc({ x: goalCX - r, y: y + height - r, width: r * 2, height: r * 2 }, 180, 180)
      .close()
      .detach()
  }, [goalCX, y, height, goalCreaseRadius])

  const p2CreaseFill = useMemo(() => {
    const r = goalCreaseRadius
    return Skia.PathBuilder.Make()
      .addArc({ x: goalCX - r, y: y - r, width: r * 2, height: r * 2 }, 0, 180)
      .close()
      .detach()
  }, [goalCX, y, goalCreaseRadius])

  // Wedge angle math lives in @tastic/physics (computeGoalWedges); the Skia path-building +
  // filled/unfilled-by-score rendering is now @tastic/sprites' ScoreWedges (see its "Score arcs"
  // render usage below) — this just supplies the raw angle array each expects.
  const p1WedgeAngles = useMemo(() => computeGoalWedges(scoreToWin, 180), [scoreToWin])
  const p2WedgeAngles = useMemo(() => computeGoalWedges(scoreToWin, 0), [scoreToWin])

  // ─── Rink pocket perimeter (curved caps behind each goal) ──────────────────
  // Ported from BoxHockey's opt-in 'rink' case, now the only geometry there is (see
  // computeBoardLayout — cornerRadius/behindGoalDepth are unconditional). Kept computed but only
  // drawn behind SHOW_RINK_DEBUG_PERIMETER, same verdict BoxHockey's own playtesting reached: the
  // device's physical screen edge already reads as the boundary, so nothing needs to be drawn.
  const rinkPerimeterPath = useMemo(() => {
    const cr = board.cornerRadius
    const outerTop = y - board.behindGoalDepth
    const outerBottom = y + height + board.behindGoalDepth
    const left = x
    const right = x + width
    return Skia.PathBuilder.Make()
      .moveTo(left, outerTop + cr)
      .addArc({ x: left, y: outerTop, width: cr * 2, height: cr * 2 }, 180, 90)
      .lineTo(right - cr, outerTop)
      .addArc({ x: right - cr * 2, y: outerTop, width: cr * 2, height: cr * 2 }, 270, 90)
      .moveTo(right, outerBottom - cr)
      .addArc({ x: right - cr * 2, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 0, 90)
      .lineTo(left + cr, outerBottom)
      .addArc({ x: left, y: outerBottom - cr * 2, width: cr * 2, height: cr * 2 }, 90, 90)
      .detach()
  }, [board.cornerRadius, board.behindGoalDepth, x, y, width, height])

  // ─── Goal celebration rings ─────────────────────────────────────────────────
  // Timing/opacity/stroke-width machinery (850/160/320ms stagger, 0.75 peak opacity, 2.5/2/1.5
  // stroke widths) now lives in @tastic/sprites' CelebrationRings — see its render usage below.
  const celebCY = lastScoredGoal === 'top' ? y : y + height
  const celebColor = lastScoredGoal === 'top' ? p2Color : p1Color

  // ─── Goal door flash (puck hit the invisible one-way door at the goal mouth) ────────────────
  // Two-layer color/opacity decay + hit-count/side gating (ported from BoxHockey unchanged) now
  // lives in @tastic/sprites' GoalDoorFlash — see its render usage below.

  const paddleRingRadius = paddleRadius * 0.35

  // ─── Zone lines ─────────────────────────────────────────────────────────────
  // A rink's blue-line equivalent, ported from BoxHockey unchanged: a bold full-width bar, in
  // each player's own color, sitting further out than the goal crease but short of center — real
  // blue lines sit about 70% of the way from the goal line to center ice, hence the 0.72
  // fraction. Spans the full board width the way a real blue line spans the full rink, so it
  // reads as "this whole zone is yours" rather than another marker for the goal itself.
  const zoneLineFraction = 0.72
  const p1ZoneLineY = y + height - (height / 2) * zoneLineFraction
  const p2ZoneLineY = y + (height / 2) * zoneLineFraction

  // ─── Rink faceoff circles ───────────────────────────────────────────────────
  // Purely decorative rink chrome, ported from BoxHockey's own faceoff-circle layout — unlike
  // there, AirHockey has no turn-based draw for these to gate (a goal just re-centers the puck,
  // see useGameState's GOAL_SERVE), so only the "permanent chrome" ring + center dot BoxHockey
  // itself renders in every state alike ever shows here; none of its live/pulse/ripple states
  // apply since there's no faceoff phase to drive them.
  const faceoffRadius = faceoffZoneRadius(board)
  const faceoffCenters: { cx: number; cy: number; color: string }[] = ([1, 2] as Player[]).flatMap((player) => faceoffZoneCenters(board, player).map((c) => ({ cx: c.x, cy: c.y, color: player === 1 ? p1Color : p2Color })))

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Goal crease background tint */}
        <Group opacity={0.28}>
          <Path path={p1CreaseFill} color={p1Color} />
          <Path path={p2CreaseFill} color={p2Color} />
        </Group>

        {/* Score arcs */}
        <ScoreWedges cx={goalCX} cy={y + height} radius={goalCreaseRadius} wedges={p1WedgeAngles} score={scores[0]} color={p1Color} unfilledColor={lineColor} />
        <ScoreWedges cx={goalCX} cy={y} radius={goalCreaseRadius} wedges={p2WedgeAngles} score={scores[1]} color={p2Color} unfilledColor={lineColor} />

        {/* Rink faceoff circles — see the comment above. */}
        {faceoffCenters.map((c, i) => (
          <FaceoffCircle key={i} x={c.cx} y={c.cy} radius={faceoffRadius} color={c.color} />
        ))}

        {/* Centerline — marks the boundary neither paddle can cross (see clampToOwnHalf in
            utils/board.ts) so it reads as a real rule of the table, not just decoration. */}
        <Line p1={vec(x, board.centerY)} p2={vec(x + width, board.centerY)} color={centerLineColor} strokeWidth={2} />

        {/* Zone lines — see the comment above. */}
        <ZoneLine x={x} width={width} y={p1ZoneLineY} color={p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
        <ZoneLine x={x} width={width} y={p2ZoneLineY} color={p2Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />

        {/* Goal lines — BoxHockey only colors these when its opt-in rink pocket is on (plain
            wallColor otherwise, since a rink-off goal line IS the solid boundary — see its own
            comment). AirHockey's pocket is unconditional, so this side of that same branch is the
            only one that ever applies: always colored, because there's always an open pocket
            behind this line for it to mark, never a solid boundary of its own — see the perimeter
            walls just below, which follow the OTHER half of that same rink-on/off branch. */}
        <Line p1={vec(x, y)} p2={vec(goalAbsLeft, y)} color={p2Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
        <Line p1={vec(goalAbsRight, y)} p2={vec(x + width, y)} color={p2Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
        <Line p1={vec(x, y + height)} p2={vec(goalAbsLeft, y + height)} color={p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />
        <Line p1={vec(goalAbsRight, y + height)} p2={vec(x + width, y + height)} color={p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} />

        {/* Goal door flash — fills in exactly the gap the two goal-line <Line>s above deliberately
            leave open (goalAbsLeft..goalAbsRight). Invisible at rest until a real door hit snaps
            both layers on — this is the ONLY visual cue that the gap isn't actually open. */}
        <GoalDoorFlash leftX={goalAbsLeft} rightX={goalAbsRight} topY={y} bottomY={y + height} topColor={p2Color} bottomColor={p1Color} strokeWidth={GOAL_LINE_STROKE_WIDTH} hitCount={goalDoorHitCount} hitSide={lastGoalDoorSide} />

        {/* Perimeter walls — same `showWalls && !rinkPerimeterPath` gate as BoxHockey, ported
            verbatim rather than simplified away: a solid wall Rect flanking the goal would draw a
            non-crossable boundary directly abutting a goal line/post that's marking a crossable
            one (see the goal lines' own comment just above) — the exact contradiction a plain
            `showWalls &&` (no rink check) was drawing here before. Since AirHockey's pocket is
            unconditional, rinkPerimeterPath is never null, so this condition is now permanently
            false and the Rects never render — same effective outcome BoxHockey's own rink-on
            case reaches, structurally identical rather than special-cased away. The device's own
            physical screen edge (native/mobile web) or open space (desktop web) is the only
            boundary drawn on the table's long sides; SHOW_RINK_DEBUG_PERIMETER below is the only
            way to see the curved pocket boundary this same gate gave up drawing. */}
        {SHOW_RINK_DEBUG_PERIMETER && <Path path={rinkPerimeterPath} style='stroke' strokeWidth={wallThickness} strokeCap='round' color={wallColor} />}
        {showWalls && !rinkPerimeterPath && (
          <>
            <ObstacleRect x={x - wallThickness} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
            <ObstacleRect x={x + width} y={y - wallThickness} width={wallThickness} height={height + wallThickness * 2} color={wallColor} />
            <ObstacleRect x={x} y={y - wallThickness} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
            <ObstacleRect x={goalAbsRight} y={y - wallThickness} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
            <ObstacleRect x={x} y={y + height} width={goalAbsLeft - x} height={wallThickness} color={wallColor} />
            <ObstacleRect x={goalAbsRight} y={y + height} width={x + width - goalAbsRight} height={wallThickness} color={wallColor} />
          </>
        )}

        {/* Obstacles — always empty (an open rink has no center divider); kept so a future variant
            could add some without touching this render loop. */}
        {obstacles.map((obs, i) => (
          <Rect key={i} x={obs.x} y={obs.y} width={obs.width} height={obs.height} color={wallColor} />
        ))}

        {/* Goal posts — small round pegs colored per-goal, not the neutral wallColor. */}
        {goalPosts.map((post, i) => (
          <GoalPost key={i} x={post.x} y={post.y} radius={post.radius} color={post.player === 1 ? p1Color : p2Color} />
        ))}

        {/* Paddles — a live, finger-controlled disc (unlike BoxHockey's swing-animated stick):
            position is driven directly by state.paddles[player] every tick, no aim/swing state to
            preview. A smaller, lighter inner ring gives it a "mallet knob" read. */}
        <Circle cx={paddles[1].x} cy={paddles[1].y} r={paddleRadius} color={p1Color} />
        <Circle cx={paddles[1].x} cy={paddles[1].y} r={paddleRingRadius} style='stroke' strokeWidth={2.5} color='#FFFFFF' />
        <Circle cx={paddles[2].x} cy={paddles[2].y} r={paddleRadius} color={p2Color} />
        <Circle cx={paddles[2].x} cy={paddles[2].y} r={paddleRingRadius} style='stroke' strokeWidth={2.5} color='#FFFFFF' />

        {/* Puck — flat black fill + a white ring that softly breathes while waiting to go live. */}
        <Disc x={puck.x} y={puck.y} radius={puckRadius} color='#000000' ringColor='#FFFFFF' ringOpacity={ringOpacity} />

        {/* Celebration rings */}
        {lastScoredGoal !== null && <CelebrationRings x={goalCX} y={celebCY} color={celebColor} baseRadius={puckRadius} maxExpansionRadius={board.goalWidth * 0.85} triggerKey={lastScoredGoal} />}
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 }
})
