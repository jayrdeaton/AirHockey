import { AchievementDefinition as BaseAchievementDefinition, DayStreakState, OutcomeRecord, RoundResult, WinStreakState } from '@tastic/achievements'
import { KeyScheme } from '@tastic/input'

export type Player = 1 | 2

// KeyScheme (wasd/arrows/ijkl/numpad) is the shared, cross-fleet set of physical key layouts, from
// @tastic/input. 'mouse' is a local addition on top — it means "keep using the paddle's own drag/
// touch input" (see TouchInputLayer.tsx), which has no keys of its own, so @tastic/input has no
// opinion on it. Only ever meaningful on desktop web — see @tastic/hud's ControlSchemePicker, which
// bakes that gate in itself.
export type ControlScheme = KeyScheme | 'mouse'

// Dramatically simpler than BoxHockey's turn/faceoff/coinFlip machine — the puck and both
// paddles are always live simultaneously ('live'), a goal pauses briefly for a re-serve
// ('goalScored') then returns to 'live', with no possession/turn concept at all.
export type GamePhase = 'idle' | 'live' | 'goalScored' | 'gameOver'

export type GameMode = 'twoPlayer' | 'vsCpu'

export type AiDifficulty = 'easy' | 'medium' | 'hard'

// Per-round puck deceleration tier — see FRICTION_LEVELS in constants/game.ts (the numeric
// coefficient each level maps to) and stepPhysics in utils/physics.ts, where it's applied as
// frictionFactor = FRICTION_LEVELS[level] ** dt.
export type FrictionLevel = 'low' | 'medium' | 'high'

// Per-round puck radius tier, as a fraction of the board's short (goal) edge — see
// PUCK_SIZE_RATIOS and GOAL_WIDTH_RATIO in constants/game.ts. Puck size doubles as a difficulty
// tier: a bigger puck also gets a wider goal to match.
export type PuckSizeLevel = 'small' | 'medium' | 'large'

// Per-round paddle (mallet) radius tier, same short-edge-fraction convention as PuckSizeLevel —
// see PADDLE_SIZE_RATIOS in constants/game.ts. New relative to BoxHockey: the paddle now
// physically collides with the puck (see applyPaddleCollision in utils/physics.ts), so its size
// is a real gameplay knob, not just cosmetic.
export type PaddleSizeLevel = 'small' | 'medium' | 'large'

export interface GameSettings {
  gameMode: GameMode
  scoreToWin: number
  aiDifficulty: AiDifficulty
  // Opt-in — see @tastic/split-screen's useAccelerometerOrientation's own `locked` param. Off by
  // default: /loadout's panel arrangement (and, in-game, the board's goal axis — see GoalAxis)
  // just follows however the device is actually being
  // held, rather than being a stored preference itself.
  lockOrientation: boolean
  friction: FrictionLevel
  puckSize: PuckSizeLevel
  paddleSize: PaddleSizeLevel
  // iOS-only. Off by default — deliberately opt-in rather than always-on, so it only kicks in for
  // someone who's actually hit the problem and gone looking for a fix, instead of every player
  // eating a "swipe twice to go home" surprise from day one. Mirrored into native UserDefaults (see
  // useGameSettings.tsx) for @tastic/edge-guard's own config plugin swizzle to read at runtime.
  deferBottomEdgeGestures: boolean
  // Web-only per-seat picker (see PlayerSetupPanel's ControlSchemePicker usage) — which physical
  // input drives each seat's paddle. 'mouse' (the default) keeps using TouchInputLayer's own drag
  // input unchanged; any KeyScheme routes that seat's paddle through KeyboardInputLayer instead.
  // Up/Down/Left/Right always drive local Y-/Y+/X-/X+ directly, the SAME absolute direction for
  // both seats (not flipped per player's own facing/goal side) — matches how any shared-screen
  // local-multiplayer game's controls read (screen-relative, not "forward" relative to each
  // player), and is the only convention that stays consistent for two people sitting side by side
  // sharing one keyboard, both looking at the same (possibly board-rotated) screen.
  controlScheme: Record<Player, ControlScheme>
}

export interface Obstacle {
  x: number
  y: number
  width: number
  height: number
}

// A small round peg at one edge of a goal mouth — same shape/role as BoxHockey's GoalPost.
// Deliberately its own shape, not an Obstacle: a post is round (circleVsCircle gives a true
// curved deflection unlike a rect's flat faces/hard corners) and colored per-goal rather than
// the neutral wall color.
export interface GoalPost {
  x: number
  y: number
  radius: number
  player: Player
}

// Which physical screen axis the two goals sit on — 'vertical' (top/bottom) in face-to-face
// portrait, 'horizontal' (left/right) in side-by-side landscape. See computeBoardLayout in
// utils/board.ts, the one place this actually branches geometry.
export type GoalAxis = 'vertical' | 'horizontal'

// Board/physics/AI all work in a single CANONICAL local space, always as if the device were
// face-to-face portrait: player 1 defends the local bottom, player 2 the local top (see
// playerGoalSide in utils/board.ts) — regardless of the real device orientation. GoalAxis records
// which REAL screen axis the goals actually sit on for exactly one purpose: game.tsx rotates the
// whole board+input tree by ±90° (a single React Native transform) when it's 'horizontal', so
// side-by-side landscape shows the same local geometry correctly mapped onto a wide screen. Every
// other consumer — physics, rendering inside the board, touch handling, the AI — reads/writes
// plain local coordinates and never has to branch on this at all; RNGH reports touch coordinates
// relative to the (already-rotated) view they land on, so no manual coordinate transform code is
// needed anywhere outside that one wrapping rotation.
export type GoalSide = 'top' | 'bottom'

export interface BoardLayout {
  x: number
  y: number
  width: number
  height: number
  goalAxis: GoalAxis
  wallThickness: number
  goalWidth: number
  // Goal opening's [start, end] along the local x axis (the short/paddle-clamp axis).
  goalStart: number
  goalEnd: number
  puckRadius: number
  paddleRadius: number
  centerX: number
  centerY: number
  // Always empty — an open rink has no center divider (unlike BoxHockey's classic/gauntlet
  // variants) — but stepPhysics' obstacle-collision loop is otherwise reused unmodified, so the
  // field/type stays rather than deleting a working, well-tested code path.
  obstacles: Obstacle[]
  goalPosts: GoalPost[]
  cornerRadius: number // rounded-corner radius at the 4 outer boundary corners — always on (unconditional, real air-hockey table geometry)
  behindGoalDepth: number // how far the true collision boundary extends past the goal line, behind each goal
}

export interface PuckState {
  x: number
  y: number
  vx: number
  vy: number
}

// A paddle's vx/vy are DERIVED each physics tick from how far its position moved since the last
// tick (see computePaddleVelocity in utils/physics.ts) — never driven directly by input. Needed
// only so applyPaddleCollision can impart a moving paddle's own motion onto the puck.
export interface PaddleState {
  x: number
  y: number
  vx: number
  vy: number
}

export type PaddleStates = Record<Player, PaddleState>

export interface GameState {
  phase: GamePhase
  scores: [number, number]
  puck: PuckState
  paddles: PaddleStates
  lastScoredGoal: GoalSide | null
  // Bumped on every TICK where stepPhysics reports a wall/goalpost/corner bounce — an ever-
  // incrementing counter (not a plain boolean) so game.tsx's own bounce SFX/haptic effect gets a
  // reliable "did a NEW bounce just happen" edge to key off of, the same reason BoxHockey's
  // identical bounceCount exists: a boolean alone can't tell "just became true" apart from
  // "already was true a tick ago" across renders.
  bounceCount: number
  // Same "counter + kind" shape as bounceCount above, ported from BoxHockey unchanged — bumped
  // whenever the puck struck the invisible one-way goal-mouth door (see physics.ts's goalDoorHit).
  // Drives Board.tsx's goal-door flash; never resets between rounds, so that effect diffs against
  // a ref rather than expecting a return to 0.
  goalDoorHitCount: number
  lastGoalDoorSide: GoalSide | null
}

// ─── Stats & achievements ───────────────────────────────────────────────────
// Tier, unlock-map and definition types come from @tastic/achievements; the shapes below are
// AirHockey's own.
export type { AchievementTier, UnlockedAchievementsState } from '@tastic/achievements'
export type AchievementDefinition = BaseAchievementDefinition<StatsState>

export type MatchRecord = OutcomeRecord

// The human is always seat 1 in vsCpu mode. A draw is impossible (a match ends the instant one
// side reaches scoreToWin), so `draws` stays 0 forever — it rides along because
// @tastic/achievements' applyResult maintains the whole quadruple.
export interface VsCpuStats extends OutcomeRecord, WinStreakState {
  byDifficulty: Record<AiDifficulty, MatchRecord>
}

// Tallied by SEAT, not by person — so this deliberately isn't an OutcomeRecord.
export interface TwoPlayerStats {
  played: number
  p1Wins: number
  p2Wins: number
}

export interface GoalTotals {
  scored: number
  conceded: number
}

export interface ProfileStats extends DayStreakState {
  vsCpu: VsCpuStats
  twoPlayer: TwoPlayerStats
  goals: GoalTotals
  shutouts: number
  bestWinMargin: number
  // Cumulative one-way goal-door hits (see GameState's own goalDoorHitCount) — the puck rattling
  // the door instead of going in. Already tracked during play, so it costs nothing to persist.
  goalDoorHits: number
}

export interface StatsState extends ProfileStats {
  profiles: Record<string, ProfileStats>
  firstGameResult: RoundResult | null
}
