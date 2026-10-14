import { Platform } from 'react-native'
import { EdgeInsets } from 'react-native-safe-area-context'

import { DESKTOP_WEB_MIN_WIDTH, FACEOFF_ZONE_RADIUS_RATIO, GOAL_LINE_STROKE_WIDTH, GOAL_OPEN_FRACTION, PADDLE_SIZE_RATIOS, PUCK_SIZE_RATIOS, TABLE_LONG_TO_SHORT_RATIO, WALL_THICKNESS } from '@/constants/game'
import { BoardLayout, GoalAxis, GoalPost, GoalSide, PaddleSizeLevel, Player, PuckSizeLevel } from '@/types'

// Mirrors game.tsx's own isDesktopWeb - desktop web is the only context that fixes the board to
// its real-world aspect ratio (TABLE_LONG_TO_SHORT_RATIO) rather than filling the viewport
// exactly, and draws literal perimeter walls into the margin that leaves. Native and mobile web
// fill their container exactly, so the device's own physical edge already reads as the boundary
// with zero gap.
function isDesktopLayout(screenWidth: number): boolean {
  return Platform.OS === 'web' && screenWidth >= DESKTOP_WEB_MIN_WIDTH
}

function boardMargin(screenWidth: number): number {
  return isDesktopLayout(screenWidth) ? WALL_THICKNESS : 0
}

export function computeViewportSize(screenWidth: number, screenHeight: number, insets: EdgeInsets): { width: number; height: number } {
  const margin = boardMargin(screenWidth)
  return {
    width: screenWidth - insets.left - insets.right - margin * 2,
    height: screenHeight - insets.top - insets.bottom - margin * 2
  }
}

// The short/long extents of the LOCAL board container - S (short axis, where the goal sits) and
// L (long axis, goal-to-goal) - derived from whichever real screen dimension is currently short
// vs. long given goalAxis. game.tsx uses this directly to size the View it rotates (see
// GoalAxis's own doc comment in types/index.ts): the container is always laid out S-wide by
// L-tall in local terms, then rotated ±90° onto the real screen when goalAxis is 'horizontal'.
export function computeLocalContainerSize(screenWidth: number, screenHeight: number, insets: EdgeInsets, goalAxis: GoalAxis): { width: number; height: number } {
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)
  const availableShort = goalAxis === 'vertical' ? availableWidth : availableHeight
  const availableLong = goalAxis === 'vertical' ? availableHeight : availableWidth

  let S = availableShort
  let L = availableLong
  if (isDesktopLayout(screenWidth)) {
    L = S * TABLE_LONG_TO_SHORT_RATIO
    if (L > availableLong) {
      L = availableLong
      S = L / TABLE_LONG_TO_SHORT_RATIO
    }
  }
  return { width: S, height: L }
}

// Which local side (always 'bottom' for player 1, 'top' for player 2 - see GoalSide's own doc
// comment) a given player defends. A plain function of the player number, not board state: this
// convention never varies board-to-board, so there's nothing to store on BoardLayout itself.
export function playerGoalSide(player: Player): GoalSide {
  return player === 1 ? 'bottom' : 'top'
}

function buildGoalPosts(x: number, y: number, height: number, goalStart: number, goalEnd: number, radius: number): GoalPost[] {
  return [
    // Player 2 defends the local top line (y).
    { x: x + goalStart, y, radius, player: 2 },
    { x: x + goalEnd, y, radius, player: 2 },
    // Player 1 defends the local bottom line (y + height).
    { x: x + goalStart, y: y + height, radius, player: 1 },
    { x: x + goalEnd, y: y + height, radius, player: 1 }
  ]
}

// Single source of truth for rink geometry, always expressed in the canonical LOCAL space (see
// GoalSide's own doc comment in types/index.ts) - goals on the local top/bottom regardless of the
// real device orientation. goalAxis is accepted only to decide which real screen dimension is
// currently "short" vs. "long" (so puck/paddle/goal sizing always derives from the true short
// edge, whichever real axis that happens to be right now) - it never branches the geometry itself
// beyond that, unlike BoxHockey's board.ts, which never needed to make that distinction at all
// since its board is permanently portrait.
export function computeBoardLayout(screenWidth: number, screenHeight: number, insets: EdgeInsets, goalAxis: GoalAxis, puckSize: PuckSizeLevel = 'medium', paddleSize: PaddleSizeLevel = 'medium'): BoardLayout {
  const { width: S, height: L } = computeLocalContainerSize(screenWidth, screenHeight, insets, goalAxis)
  const { width: availableWidth, height: availableHeight } = computeViewportSize(screenWidth, screenHeight, insets)
  const availableShort = goalAxis === 'vertical' ? availableWidth : availableHeight
  const availableLong = goalAxis === 'vertical' ? availableHeight : availableWidth

  const margin = boardMargin(screenWidth)
  const puckRadius = S * PUCK_SIZE_RATIOS[puckSize]
  const paddleRadius = S * PADDLE_SIZE_RATIOS[paddleSize]
  // See GOAL_OPEN_FRACTION's own comment: derived from the actual paddle+puck blocking span (not
  // an independent flat fraction of S) so the goal stays fair for every size combination.
  const blockingSpan = (paddleRadius + puckRadius) * 2
  const goalWidth = blockingSpan / (1 - GOAL_OPEN_FRACTION)
  const goalStart = (S - goalWidth) / 2
  const goalEnd = goalStart + goalWidth

  // Real air-hockey table geometry, unconditional (not an opt-in toggle like BoxHockey's
  // `rink: boolean`) - rounded outer corners and a real pocket behind each goal the puck can
  // skate into, so it can never permanently stall in a corner. Same formulas BoxHockey uses for
  // its opt-in rink-on case, evaluated against the local short axis S.
  const behindGoalDepth = puckRadius * 2.5 + WALL_THICKNESS
  const cornerRadius = S * 0.12

  const outerShortStart = margin + (availableShort - S) / 2
  const outerLongStart = margin + (availableLong - L) / 2

  const x = outerShortStart
  const y = outerLongStart + behindGoalDepth
  const width = S
  const height = L - behindGoalDepth * 2

  const postRadius = puckRadius * 0.18

  return {
    x,
    y,
    width,
    height,
    goalAxis,
    wallThickness: GOAL_LINE_STROKE_WIDTH,
    goalWidth,
    goalStart,
    goalEnd,
    puckRadius,
    paddleRadius,
    centerX: x + width / 2,
    centerY: y + height / 2,
    obstacles: [],
    goalPosts: buildGoalPosts(x, y, height, goalStart, goalEnd, postRadius),
    cornerRadius,
    behindGoalDepth
  }
}

export function centerPuck(board: BoardLayout): { x: number; y: number } {
  return { x: board.centerX, y: board.centerY }
}

// A player's defensive rest position - their own goal line, offset in - used to reset both
// paddles after a goal (see GOAL_SERVE in useGameState.ts) and as the AI's own "retreat and cover
// the net" target when the puck isn't a threat (see aiOpponent.ts).
const PADDLE_HOME_OFFSET_RATIO = 1.5

export function centerPaddle(board: BoardLayout, player: Player): { x: number; y: number } {
  const offset = board.paddleRadius * PADDLE_HOME_OFFSET_RATIO
  const y = playerGoalSide(player) === 'bottom' ? board.y + board.height - offset : board.y + offset
  return { x: board.centerX, y }
}

// Rink faceoff circle positions, ported from BoxHockey's own faceoffZoneCenters unchanged (same
// 0.27/0.42 offsets - BoxHockey's non-gauntlet faceoffOffsetYRatio) - two per player, flanking
// their own goal. Board.tsx renders both purely as static rink chrome (see FACEOFF_ZONE_RADIUS_
// RATIO's own comment); useGameState's GOAL_SERVE is the only thing that actually PICKS one (see
// faceoffZoneCenter below) - the scored-on player's own zone, giving them the restart, same as a
// real rink awards the ensuing faceoff to whoever just conceded. There's no board-variant knob to
// key faceoffOffsetYRatio off, so it's inlined rather than carried as a BoardLayout field the way
// BoxHockey needs it to be.
const FACEOFF_OFFSET_Y_RATIO = 0.42

export function faceoffZoneCenters(board: BoardLayout, player: Player): { x: number; y: number }[] {
  const goalCX = board.x + (board.goalStart + board.goalEnd) / 2
  const offsetX = board.width * 0.27
  const offsetY = (board.height / 2) * FACEOFF_OFFSET_Y_RATIO
  const cy = playerGoalSide(player) === 'bottom' ? board.y + board.height - offsetY : board.y + offsetY
  return [
    { x: goalCX - offsetX, y: cy },
    { x: goalCX + offsetX, y: cy }
  ]
}

export function faceoffZoneCenter(board: BoardLayout, player: Player, zoneIndex: 0 | 1): { x: number; y: number } {
  return faceoffZoneCenters(board, player)[zoneIndex]
}

export function faceoffZoneRadius(board: BoardLayout): number {
  return board.width * FACEOFF_ZONE_RADIUS_RATIO
}

// Clamps a target position to a player's own playable half - both the board's own outer bounds
// (minus radius) AND their own side of the local centerline (minus radius, so the paddle disc's
// own edge stops exactly at the centerline rather than overlapping it). Shared by
// TouchInputLayer's setPaddleTarget (a human's live drag) and aiOpponent's target selection - the
// same clamp rule applies to both input sources, so it lives here once.
export function clampToOwnHalf(x: number, y: number, board: BoardLayout, player: Player, radius: number): { x: number; y: number } {
  const minX = board.x + radius
  const maxX = board.x + board.width - radius
  const minY = board.y + radius
  const maxY = board.y + board.height - radius
  const cx = Math.min(maxX, Math.max(minX, x))
  let cy = Math.min(maxY, Math.max(minY, y))
  cy = playerGoalSide(player) === 'bottom' ? Math.max(cy, board.centerY + radius) : Math.min(cy, board.centerY - radius)
  return { x: cx, y: cy }
}
