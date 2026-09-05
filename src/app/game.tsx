import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { rotateInsets, useAccelerometerOrientation } from '@tastic/split-screen'
import { router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import Board from '@/components/BoardHost'
import KeyboardInputLayer from '@/components/KeyboardInputLayer'
import { SettingsDialog } from '@/components/SettingsDialog'
import TouchInputLayer from '@/components/TouchInputLayer'
import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { DESKTOP_WEB_MIN_WIDTH, FRICTION_LEVELS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { GoalAxis, Player } from '@/types'
import { computeBoardLayout, computeLocalContainerSize } from '@/utils/board'
import { humanPlayersFor } from '@/utils/gameMode'
import { DEFAULT_SETTINGS } from '@/utils/gameSettingsValidation'
import { safeBack } from '@/utils/navigation'

export default function GameScreen() {
  // Committed once by /loadout when every human player readied up — falls back to defaults for a
  // direct/deep link to this screen, which never went through /loadout to commit anything.
  // settings/setSettings (the persisted "next round" defaults, not this round's own locked-in
  // activeRoundSettings above) are only needed to hand off to SettingsDialog below — its Lock
  // Orientation/Edge Guard toggles edit the persisted defaults, not this already-underway round's
  // own snapshot.
  const { activeRoundSettings, settings, setSettings } = useGameSettings()
  const { recordMatchOutcome } = useGameStats()
  const { lastSelected } = useProfiles()
  const { success: showAchievementToast } = useToast()
  const roundSettings = activeRoundSettings ?? DEFAULT_SETTINGS
  const scoreToWin = roundSettings.scoreToWin
  const friction = FRICTION_LEVELS[roundSettings.friction]
  const puckSize = roundSettings.puckSize
  const paddleSize = roundSettings.paddleSize
  // Only P2 can be CPU-controlled — pass-and-play stays the default, single-player just swaps who
  // controls P2's paddle (see useAIOpponent, which drives it through the exact same setPaddleTarget
  // path a human's touch uses).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty
  const humanPlayers = humanPlayersFor(roundSettings.gameMode)

  // Unlike BoxHockey (always pinned portrait, since its board is always vertical), AirHockey's
  // board adapts to either orientation (see GoalAxis's own doc comment in types/index.ts) — so
  // this only pins the reading at all when the player has explicitly opted in via
  // GameSettings.lockOrientation, freezing whichever orientation happens to be live at that moment.
  const { orientationMode, p1OnRight } = useAccelerometerOrientation(roundSettings.lockOrientation)
  const goalAxis: GoalAxis = orientationMode === 'sideBySide' ? 'horizontal' : 'vertical'

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // computeBoardLayout's own local space is ALWAYS canonically portrait-shaped (see GoalSide's doc
  // comment in types/index.ts) regardless of goalAxis — goalAxis only decides which real screen
  // dimension feeds its short-vs-long split, not the shape of what it hands back. So this ±90°
  // exists to visually turn that always-tall container into a landscape-looking one whenever
  // goalAxis is 'horizontal' — unlike @tastic/split-screen's own getViewRotation (which compensates
  // specifically for a portrait-locked OS refusing to rotate its render surface), this need is
  // unrelated to OS lock state and applies on every platform, web included.
  const rotationDeg: 0 | 90 | -90 = goalAxis === 'horizontal' ? (p1OnRight ? 90 : -90) : 0

  // Unlike the rotation above, THIS swap is genuinely native-only: computeBoardLayout expects
  // screenWidth/screenHeight to reflect the VISUAL orientation directly (width > height once truly
  // in landscape) — true on web, where the browser window itself is already the correct shape once
  // wide (useAccelerometerOrientation's own web fallback derives 'horizontal' from exactly that), so
  // useWindowDimensions() there is used as-is. Native is portrait-locked at the OS level, so
  // useWindowDimensions() always reports portrait W×H no matter how the phone is actually held —
  // swapped here, at this one call site, to re-derive what genuine landscape dimensions would have
  // been, rather than touching computeBoardLayout's own long-established S/L-split math.
  const swapForOsPortraitLock = Platform.OS !== 'web' && goalAxis === 'horizontal'
  const logicalWidth = swapForOsPortraitLock ? height : width
  const logicalHeight = swapForOsPortraitLock ? width : height
  // rotateInsets always returns a fresh object, so this has to be memoized on insets/rotationDeg
  // itself — otherwise logicalInsets is a new reference every render, which busts the board
  // useMemo below on every render regardless of whether anything actually changed, which in turn
  // busts useGameState's own board-reference-equality check (its RESCALE effect, keyed on
  // `board !== prevBoard`) and fires an unbounded dispatch loop.
  const logicalInsets = useMemo(() => rotateInsets(insets, rotationDeg), [insets, rotationDeg])

  // board (canonical LOCAL geometry — see GoalSide's doc comment in types/index.ts) and localSize
  // (the container BEFORE the rotation below) are derived from the same S/L split, so they always
  // agree with each other regardless of goalAxis.
  const board = useMemo(() => computeBoardLayout(logicalWidth, logicalHeight, logicalInsets, goalAxis, puckSize, paddleSize), [logicalWidth, logicalHeight, logicalInsets, goalAxis, puckSize, paddleSize])
  const localSize = useMemo(() => computeLocalContainerSize(logicalWidth, logicalHeight, logicalInsets, goalAxis), [logicalWidth, logicalHeight, logicalInsets, goalAxis])
  const outerWidth = width - insets.left - insets.right
  const outerHeight = height - insets.top - insets.bottom
  // The local container is flex-centered within the outer viewport (see the `viewport` style
  // below), so its own screen-space center always coincides with the outer viewport's center —
  // TouchInputLayer needs this (plus the rotation itself) to convert a touch's real screen
  // position back into local board coordinates by hand (see its own screenToLocal comment for
  // why this can't just rely on a zone's own e.x/e.y). Deliberately the RAW (physical, un-swapped)
  // width/height/insets, unlike the board geometry above — a real touch always arrives in real
  // physical screen coordinates regardless of the CSS rotation trick, so this has to stay in that
  // same physical space for TouchInputLayer's own un-rotation math to line up with it.
  const screenCenterX = insets.left + outerWidth / 2
  const screenCenterY = insets.top + outerHeight / 2

  // Settings/quit-confirm dialogs pause gameplay while open.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmBackVisible, setConfirmBackVisible] = useState(false)
  const paused = settingsOpen || confirmBackVisible

  const { state, setPaddleTarget, resetGame } = useGameState(board, scoreToWin, friction, paused)
  const { phase, puck, paddles, scores, lastScoredGoal, bounceCount, goalDoorHitCount, lastGoalDoorSide } = state

  useAIOpponent(state, board, aiPlayer, aiDifficulty, paused, setPaddleTarget)

  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_MIN_WIDTH

  const { dark, colors: themeColors } = useAutoPaperTheme()
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  const cardBg = dark ? '#111111' : '#F2F2F2'
  const cardBorder = dark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'

  const playerColor: Record<Player, string> = { 1: themeColors.primary, 2: themeColors.secondary }
  const playerOnColor: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const winner: Player = scores[0] >= scoreToWin ? 1 : 2
  const loser: Player = winner === 1 ? 2 : 1

  const vibration = useVibration()
  const vibrationRef = useRef(vibration)
  useEffect(() => {
    vibrationRef.current = vibration
  })

  const playBounce = useGameSound(require('../../assets/sounds/bounce.wav'))
  const playGoal = useGameSound(require('../../assets/sounds/goal.wav'))
  const playWin = useGameSound(require('../../assets/sounds/win.wav'))
  const soundRef = useRef({ playBounce, playGoal, playWin })
  useEffect(() => {
    soundRef.current = { playBounce, playGoal, playWin }
  })

  const onBackPress = () => {
    if (scores[0] > 0 || scores[1] > 0) setConfirmBackVisible(true)
    else safeBack()
  }

  const firstBounceRender = useRef(true)
  useEffect(() => {
    if (firstBounceRender.current) {
      firstBounceRender.current = false
      return
    }
    vibrationRef.current.short()
    soundRef.current.playBounce()
  }, [bounceCount])

  const prevScoresRef = useRef(scores)
  useEffect(() => {
    const [prevP1, prevP2] = prevScoresRef.current
    prevScoresRef.current = scores
    if (scores[0] !== prevP1 || scores[1] !== prevP2) {
      vibrationRef.current.notification()
      soundRef.current.playGoal()
    }
  }, [scores])

  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== 'gameOver' && phase === 'gameOver') {
      soundRef.current.playWin()
      // Recorded on the transition rather than in the reducer, which runs every physics step and
      // has no notion of "this is new". prevPhaseRef guards a re-run from any other dep changing.
      const matchWinner: Player = scores[0] >= scoreToWin ? 1 : 2
      const profileIds = { 1: lastSelected[1] ?? undefined, 2: aiPlayer === null ? (lastSelected[2] ?? undefined) : undefined }
      const result = recordMatchOutcome({ winner: matchWinner, scores: [scores[0], scores[1]], goalDoorHits: goalDoorHitCount }, { gameMode: roundSettings.gameMode, aiDifficulty, profileIds })
      const seatUnlocks = aiPlayer === null ? [...(result.profiles[1] ?? []), ...(result.profiles[2] ?? [])] : (result.profiles[1] ?? [])
      ;[...result.device, ...seatUnlocks].forEach((achievement) => {
        showAchievementToast(achievement.title, 'Achievement unlocked', undefined, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon })
      })
    }
    prevPhaseRef.current = phase
  }, [phase, scores, scoreToWin, aiPlayer, aiDifficulty, goalDoorHitCount, lastSelected, roundSettings.gameMode, recordMatchOutcome, showAchievementToast])

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar hidden />

      {/* Local-space board + input area — sized to localSize (the container BEFORE rotation),
          centered within the real safe-area viewport, then rotated ±90° for side-by-side
          landscape so the SAME canonical local geometry (see GoalSide's own doc comment) maps
          onto a wide screen correctly. Board's Skia canvas is written purely in local
          coordinates and never branches on goalAxis at all — DOM/native hit-testing correctly
          respects this rotation when deciding which zone a touch lands on, so TouchInputLayer's
          two zones don't need to branch on axis either. Only the touch's own COORDINATE VALUE
          needs explicit handling: TouchInputLayer converts e.absoluteX/Y back into local space
          itself (see its own screenToLocal comment for why — verified in the browser preview
          that react-native-gesture-handler's web e.x/e.y do NOT correctly invert an ancestor's
          CSS rotation the way native touch delivery would), which is why it needs
          screenCenterX/Y and rotationDeg passed in below, matching this same rotation exactly.
          Rotation direction confirmed empirically in the browser preview (a hand-derived
          clockwise/counter-clockwise expectation didn't match RN-web's actual rotate() sign, so
          this is calibrated against the real render, not re-derived from theory): '90deg' puts
          player 1 (local bottom) on the screen's RIGHT, '-90deg' puts them on the LEFT. */}
      <View style={[styles.viewport, { top: insets.top, left: insets.left, width: outerWidth, height: outerHeight }]}>
        <View style={[styles.localContainer, { width: localSize.width, height: localSize.height }, rotationDeg !== 0 && { transform: [{ rotate: `${rotationDeg}deg` }] }]}>
          <Board board={board} puck={puck} paddles={paddles} phase={phase} scores={scores} scoreToWin={scoreToWin} lastScoredGoal={lastScoredGoal} goalDoorHitCount={goalDoorHitCount} lastGoalDoorSide={lastGoalDoorSide} showWalls={isDesktopWeb} />
          {/* Zones themselves still live inside this same rotated container — DOM/native hit-
              testing needs their rotated screen footprint to correctly decide WHICH zone a touch
              landed on; only the resulting coordinate VALUE (screenToLocal, using
              screenCenterX/Y + rotationDeg below) needs the explicit, non-rotation-relative fix. */}
          <TouchInputLayer humanPlayers={humanPlayers} enabled={!paused} localWidth={localSize.width} localHeight={localSize.height} screenCenterX={screenCenterX} screenCenterY={screenCenterY} rotationDeg={rotationDeg} onPaddleTarget={setPaddleTarget} />
        </View>
      </View>

      {/* Web-only, additive keyboard input — see that component's own doc for why it needs no
      rotation-awareness the way TouchInputLayer does. paddles[1]/paddles[2] are read fresh every
      frame internally (not reactively), so passing the current `paddles` snapshot here on every
      render is exactly right, not stale. */}
      <KeyboardInputLayer enabled={!paused} humanPlayers={humanPlayers} controlScheme={roundSettings.controlScheme} paddlePos={{ 1: paddles[1], 2: paddles[2] }} onPaddleTarget={setPaddleTarget} />

      {/* Game Over overlay */}
      {phase === 'gameOver' && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source='trophy' size={64} color={playerColor[winner]} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: playerColor[winner], fontFamily: MONO_FONT }]}>
              Wins!
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={() => resetGame(board)} style={styles.overlayButton} buttonColor={playerColor[loser]} textColor={playerOnColor[loser]}>
              Play Again
            </Button>
            <Button mode='contained' onPress={() => router.back()} style={styles.overlayButton} buttonColor={playerColor[winner]} textColor={playerOnColor[winner]}>
              Loadout
            </Button>
          </View>
        </View>
      )}

      {/* Quit confirmation */}
      {confirmBackVisible && (
        <View style={styles.overlay}>
          <View style={[styles.overlayCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <Icon source='alert-circle-outline' size={64} color={themeColors.secondary} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: themeColors.secondary, fontFamily: MONO_FONT }]}>
              Quit Match?
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> – </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            <Button mode='contained' onPress={() => setConfirmBackVisible(false)} style={styles.overlayButton} buttonColor={themeColors.primary} textColor={themeColors.onPrimary}>
              Cancel
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={themeColors.secondary} textColor={themeColors.onSecondary}>
              Quit
            </Button>
          </View>
        </View>
      )}

      {/* Back + settings — fixed top corners, same convention as index.tsx/loadout.tsx. Unlike
          BoxHockey's centerline-on-the-dividing-wall placement (needed there because its board is
          split face-to-face with P2's half rotated 180°), AirHockey's board is never rotated per
          player — only the whole board rotates as a unit for GoalAxis — so a top corner never
          sits inside either player's own zone. */}
      <View style={[styles.backButton, { top: insets.top, left: insets.left }]}>
        <IconButton icon='arrow-left' iconColor={bg} containerColor={fg} style={styles.chipButton} size={24} onPress={onBackPress} />
      </View>
      <View style={[styles.settingsButton, { top: insets.top, right: insets.right }]}>
        <IconButton icon='cog' iconColor={bg} containerColor={fg} style={styles.chipButton} size={24} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      </View>

      {/* rotation={rotationDeg} — same physical-hold-compensating rotation the board itself uses
      (see rotationDeg's own comment above), not a separate reading; previously omitted entirely,
      leaving this dialog's content stuck unrotated in the 'horizontal' goalAxis orientation while
      index.tsx/loadout.tsx's own dialogs correctly rotated. */}
      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotationDeg} settings={settings} setSettings={setSettings} />
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: { position: 'absolute' },
  chipButton: { margin: 0 },
  // Deliberately NOT position: 'absolute' — it needs to stay a normal flex child of `viewport`
  // so that parent's alignItems/justifyContent: 'center' actually centers it (an absolutely
  // positioned child ignores its parent's flex alignment entirely and defaults to pinning at
  // (0,0) instead, which is what silently put the whole board off-center before this was caught
  // in the browser preview).
  localContainer: {},
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  overlayButton: { width: 160 },
  overlayCard: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 32
  },
  overlayScore: {},
  overlayTitle: { fontWeight: 'bold' },
  root: { flex: 1 },
  settingsButton: { position: 'absolute' },
  viewport: { alignItems: 'center', justifyContent: 'center', position: 'absolute' }
})
