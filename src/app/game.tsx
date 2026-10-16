import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton, useVibration } from '@rific/feedback-press'
import { useToast } from '@rific/toaster'
import { broadcastDeviceUnlocks } from '@tastic/achievements'
import { rotateInsets, useBackgroundPause, useOrientationState } from '@tastic/core'
import { AchievementUnlockList, type AchievementUnlockOwner, ConfirmDialog, OverlayBackdrop, OverlayCard, useOverlayCardColors, useQuitConfirmation } from '@tastic/hud'
import { Profile } from '@tastic/profile'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import Board from '@/components/BoardHost'
import KeyboardInputLayer from '@/components/KeyboardInputLayer'
import { SettingsDialog } from '@/components/SettingsDialog'
import TouchInputLayer from '@/components/TouchInputLayer'
import { ACHIEVEMENT_TIER_COLORS } from '@/constants/achievements'
import { MONO_FONT } from '@/constants/fonts'
import { DESKTOP_WEB_MIN_WIDTH, FRICTION_LEVELS } from '@/constants/game'
import { useAIOpponent } from '@/hooks/useAIOpponent'
import { useGameSound } from '@/hooks/useGameSound'
import { useGameState } from '@/hooks/useGameState'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { useSettings } from '@/hooks/useSettings'
import { liveplayActions } from '@/redux/liveplaySlice'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import type { AppDispatch, RootState } from '@/redux/store'
import { AchievementDefinition, GoalAxis, Player } from '@/types'
import { computeBoardLayout, computeLocalContainerSize } from '@/utils/board'
import { humanPlayersFor } from '@/utils/gameMode'
import { safeBack } from '@/utils/navigation'

// Converts a point expressed in the board's own LOCAL coordinate space (the same frame board.x/y
// lives in) into a real, absolute screen position - mirrors Pong's own localToScreen exactly (see
// its doc comment there), needed here for the same reason: floating UI (the back/settings chips
// below) lives OUTSIDE the rotated local container, so anchoring it to "the board's own top-left
// corner" only lands in the right real screen spot if this applies the SAME rotationDeg the
// container itself was rotated by.
function localToScreen(localX: number, localY: number, containerWidth: number, containerHeight: number, screenCenterX: number, screenCenterY: number, rotation: 0 | 90 | -90): { x: number; y: number } {
  const lx = localX - containerWidth / 2
  const ly = localY - containerHeight / 2
  let dx: number
  let dy: number
  if (rotation === 90) {
    dx = -ly
    dy = lx
  } else if (rotation === -90) {
    dx = ly
    dy = -lx
  } else {
    dx = lx
    dy = ly
  }
  return { x: screenCenterX + dx, y: screenCenterY + dy }
}

const SEATS: readonly Player[] = [1, 2]

export default function GameScreen() {
  // Committed once by /loadout when every human player readied up - falls back to defaults for a
  // direct/deep link to this screen, which never went through /loadout to commit anything.
  // settings/setSettings (the persisted "next round" defaults, not this round's own locked-in
  // activeRoundSettings above) are only needed to hand off to SettingsDialog below - its Lock
  // Orientation/Edge Guard toggles edit the persisted defaults, not this already-underway round's
  // own snapshot. Lock Orientation still applies to this round at once: _layout.tsx's
  // OrientationBridge feeds the persisted value to the shared orientation reading the board reads
  // below, so the round's own copy of that setting is never consulted.
  const { settings, setSettings } = useSettings()
  const activeRoundSettings = useSelector((state: RootState) => state.liveplay.activeRoundSettings)
  const dispatch = useDispatch<AppDispatch>()
  const { recordMatchOutcome } = useGameStats()
  const { profiles, lastSelected } = useProfiles()
  const { clear: clearToasts, success: showAchievementToast } = useToast()
  const roundSettings = activeRoundSettings ?? DEFAULT_SETTINGS
  const scoreToWin = roundSettings.scoreToWin
  const friction = FRICTION_LEVELS[roundSettings.friction]
  const puckSize = roundSettings.puckSize
  const paddleSize = roundSettings.paddleSize
  const rink = roundSettings.rink
  // Only P2 can be CPU-controlled - pass-and-play stays the default, single-player just swaps who
  // controls P2's paddle (see useAIOpponent, which drives it through the exact same setPaddleTarget
  // path a human's touch uses).
  const aiPlayer: Player | null = roundSettings.gameMode === 'vsCpu' ? 2 : null
  const aiDifficulty = roundSettings.aiDifficulty
  const humanPlayers = humanPlayersFor(roundSettings.gameMode)

  // Unlike BoxHockey (always pinned portrait, since its board is always vertical), AirHockey's
  // board adapts to either orientation (see GoalAxis's own doc comment in types/index.ts), so the
  // goal axis and touch mapping follow the shared reading. Lock Orientation freezes that reading
  // app-wide (see OrientationBridge in _layout.tsx), the board included: while it's on, tilting the
  // phone never flips the goal axis, and toggling it from this screen's own Settings dialog takes
  // effect immediately rather than waiting for the next round.
  const { orientationMode, p1OnRight } = useOrientationState()
  const goalAxis: GoalAxis = orientationMode === 'sideBySide' ? 'horizontal' : 'vertical'

  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // computeBoardLayout's own local space is ALWAYS canonically portrait-shaped (see GoalSide's doc
  // comment in types/index.ts) regardless of goalAxis - goalAxis only decides which real screen
  // dimension feeds its short-vs-long split, not the shape of what it hands back. So this ±90°
  // exists to visually turn that always-tall container into a landscape-looking one whenever
  // goalAxis is 'horizontal' - unlike @tastic/core's own getViewRotation (which compensates
  // specifically for a portrait-locked OS refusing to rotate its render surface), this need is
  // unrelated to OS lock state and applies on every platform, web included.
  const rotationDeg: 0 | 90 | -90 = goalAxis === 'horizontal' ? (p1OnRight ? 90 : -90) : 0

  // Unlike the rotation above, THIS swap is genuinely native-only: computeBoardLayout expects
  // screenWidth/screenHeight to reflect the VISUAL orientation directly (width > height once truly
  // in landscape) - true on web, where the browser window itself is already the correct shape once
  // wide (useOrientationState's own web fallback derives 'horizontal' from exactly that), so
  // useWindowDimensions() there is used as-is. Native is portrait-locked at the OS level, so
  // useWindowDimensions() always reports portrait W×H no matter how the phone is actually held -
  // swapped here, at this one call site, to re-derive what genuine landscape dimensions would have
  // been, rather than touching computeBoardLayout's own long-established S/L-split math.
  const swapForOsPortraitLock = Platform.OS !== 'web' && goalAxis === 'horizontal'
  const logicalWidth = swapForOsPortraitLock ? height : width
  const logicalHeight = swapForOsPortraitLock ? width : height
  // rotateInsets always returns a fresh object, so this has to be memoized on insets/rotationDeg
  // itself - otherwise logicalInsets is a new reference every render, which busts the board
  // useMemo below on every render regardless of whether anything actually changed, which in turn
  // busts useGameState's own board-reference-equality check (its RESCALE effect, keyed on
  // `board !== prevBoard`) and fires an unbounded dispatch loop.
  const logicalInsets = useMemo(() => rotateInsets(insets, rotationDeg), [insets, rotationDeg])

  // board (canonical LOCAL geometry - see GoalSide's doc comment in types/index.ts) and localSize
  // (the container BEFORE the rotation below) are derived from the same S/L split, so they always
  // agree with each other regardless of goalAxis.
  const board = useMemo(() => computeBoardLayout(logicalWidth, logicalHeight, logicalInsets, goalAxis, puckSize, paddleSize, rink), [logicalWidth, logicalHeight, logicalInsets, goalAxis, puckSize, paddleSize, rink])
  const localSize = useMemo(() => computeLocalContainerSize(logicalWidth, logicalHeight, goalAxis), [logicalWidth, logicalHeight, goalAxis])
  // The local container is flex-centered within the full-screen viewport (see the `viewport` style
  // below), so its own screen-space center always coincides with the screen's center -
  // TouchInputLayer needs this (plus the rotation itself) to convert a touch's real screen
  // position back into local board coordinates by hand (see its own screenToLocal comment for
  // why this can't just rely on a zone's own e.x/e.y). Deliberately the RAW (physical, un-swapped)
  // width/height, unlike the board geometry above - a real touch always arrives in real physical
  // screen coordinates regardless of the CSS rotation trick, so this has to stay in that same
  // physical space for TouchInputLayer's own un-rotation math to line up with it.
  const screenCenterX = width / 2
  const screenCenterY = height / 2

  // Settings/quit-confirm dialogs pause gameplay while open. useQuitConfirmation reads hasProgress
  // lazily (only inside a real requestBack() call, via its own ref-mirrored getter - see that
  // hook's own doc) rather than taking a plain boolean, which is exactly what makes this safe to
  // call before `scores` exists yet: `scores` comes from useGameState's returned state, which
  // itself needs `paused` (derived from confirmVisible) as an INPUT, so a plain-boolean argument
  // computed from `scores` here would be a real circular render dependency. The closure below
  // still reads whatever `scores` is bound to at the time the closure itself is (re)created each
  // render, same as a hand-rolled onBackPress body always did before this hook existed.
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Once the match is over (gameOver) its stats are already recorded and nothing is lost, so back
  // exits at once, the same as the Game Over card's own buttons.
  const { confirmVisible, requestBack, cancelBack } = useQuitConfirmation(() => phase !== 'gameOver' && (scores[0] > 0 || scores[1] > 0), safeBack)
  // Leaving the app mid-match (home, app switch, a phone call, Control Center) latches a pause that
  // only the Paused dialog's Resume clears - see @tastic/core's useBackgroundPause. Skipped once the
  // match is over, or while a dialog already holds the pause by itself.
  const { backgroundPaused, resume } = useBackgroundPause(() => phase !== 'gameOver' && !settingsOpen && !confirmVisible)
  // Keeps the screen from dimming and locking while a match is up, unless Keep Awake is off in
  // Settings (read live, so the toggle applies mid-match). Expo only does this by itself in
  // development builds, and the OS auto-lock only counts screen touches, so tilt or keyboard steering,
  // or watching the CPU, could let a release build lock mid-match. Failures are dropped: a browser
  // without the Screen Wake Lock API (or one that refuses it) just keeps its own timeout.
  const keepAwake = useSelector((state: RootState) => state.settings.keepAwake)
  useEffect(() => {
    if (!keepAwake) return undefined
    activateKeepAwakeAsync('game').catch(() => {})
    return () => {
      deactivateKeepAwake('game').catch(() => {})
    }
  }, [keepAwake])
  const paused = settingsOpen || confirmVisible || backgroundPaused

  // Two-player (pass-and-play) only - seat -> that seat's own newly-unlocked achievements this
  // match, read by the two-player Game Over overlay below to badge each seat correctly (see the
  // gameOver effect below for why this replaces showAchievementToast for that mode specifically).
  const [seatUnlocks, setSeatUnlocks] = useState<Partial<Record<Player, AchievementDefinition[]>>>({})

  const { state, setPaddleTarget, resetGame } = useGameState(board, scoreToWin, friction, paused)
  const { phase, puck, paddles, scores, lastScoredGoal, bounceCount, goalDoorHitCount, lastGoalDoorSide } = state

  // Mirrors "an actual live rally, not paused" into liveplay.activelyPlaying for Providers.tsx's
  // EdgeGuardBridge rather than calling useEdgeGestureGuard directly here: it stays mounted once for
  // the app's lifetime, and this is just the one signal it has no other way to read. Unlocked between points (idle/goalScored/gameOver) and whenever a
  // dialog is open (paused) - back/settings stay unconditionally visible here (unlike Snake/
  // LightCycles), so there's no button-visibility signal to key off instead. Reset to false on
  // unmount too, so leaving this screen mid-rally by any path can't leave Edge Guard stuck on.
  useEffect(() => {
    dispatch(liveplayActions.setActivelyPlaying(phase === 'live' && !paused))
    return () => {
      dispatch(liveplayActions.setActivelyPlaying(false))
    }
  }, [phase, paused, dispatch])

  // No toast may stay on screen during live play - only between rounds or at game over. Unlock
  // toasts fire at game over and last 7s, so a quick restart would otherwise carry them into the
  // next rally.
  useEffect(() => {
    if (phase === 'live') clearToasts()
  }, [phase, clearToasts])

  useAIOpponent(state, board, aiPlayer, aiDifficulty, paused, setPaddleTarget)

  const isDesktopWeb = Platform.OS === 'web' && width >= DESKTOP_WEB_MIN_WIDTH

  const { dark, colors: themeColors } = useAutoPaperTheme()
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  // The Game Over card and the dialogs' score lines sit on @tastic/hud's OverlayCard, so their text
  // takes its theme colors rather than this screen's literal black/white.
  const { fg: cardFg, fgMuted } = useOverlayCardColors()

  const playerColor: Record<Player, string> = { 1: themeColors.primary, 2: themeColors.secondary }
  const playerOnColor: Record<Player, string> = { 1: themeColors.onPrimary, 2: themeColors.onSecondary }
  const winner: Player = scores[0] >= scoreToWin ? 1 : 2
  const loser: Player = winner === 1 ? 2 : 1
  // Whichever profile each seat had selected, if any - read the same way Pong's own game.tsx looks
  // theirs up, so the two-player achievement badges below can identify whose unlock is whose.
  const seatProfile: Partial<Record<Player, Profile>> = { 1: profiles.find((p) => p.id === lastSelected[1]) ?? undefined, 2: profiles.find((p) => p.id === lastSelected[2]) ?? undefined }
  const achievementOwners: Record<Player, AchievementUnlockOwner> = { 1: { profile: seatProfile[1], color: playerColor[1] }, 2: { profile: seatProfile[2], color: playerColor[2] } }

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
      if (aiPlayer === null) {
        // Genuine two-seat pass-and-play - showAchievementToast below is a single, screen-fixed
        // @rific/toaster call with no rotation of its own, so it only ever reads right-side-up for
        // whichever seat happens to match the board's current rotationDeg. A player seated at the
        // opposite end of the table (the far side of a portrait/vertical-goalAxis hold, same as
        // real air hockey) would see it upside-down even though it's their own achievement.
        // Broadcasting into seatUnlocks instead lets the two-player Game Over overlay below (which
        // already carries the board's own rotationStyle) show each seat's own unlocks once the
        // match settles - same fix Pong's/LightCycles' own game.tsx applies, for the identical
        // reason. The winner's seat also gets the device-wide unlocks that are really its own (all
        // of them for a guest, only scope: 'device' ones for a profile; see @tastic/achievements'
        // broadcastDeviceUnlocks). The loser's card shows only its own (audit F037).
        const broadcast = broadcastDeviceUnlocks([1, 2] as Player[], result.profiles, result.device, profileIds, { winners: [matchWinner] })
        // eslint-disable-next-line react-hooks/set-state-in-effect -- a real one-shot transition guarded by prevPhaseRef above, not a render loop; the sibling vsCpu branch below fires showAchievementToast (which does the same thing inside @rific/toaster) unconditionally in this same effect
        setSeatUnlocks(broadcast)
      } else {
        // vsCpu only ever has one human perspective (seat 1) to address - the shared, screen-fixed
        // toast is fine here.
        ;(broadcastDeviceUnlocks([1] as Player[], result.profiles, result.device, profileIds)[1] ?? []).forEach((achievement) => {
          showAchievementToast(achievement.title, 'Achievement unlocked', undefined, { color: ACHIEVEMENT_TIER_COLORS[achievement.tier], icon: achievement.icon })
        })
      }
    }
    prevPhaseRef.current = phase
  }, [phase, scores, scoreToWin, aiPlayer, aiDifficulty, goalDoorHitCount, lastSelected, roundSettings.gameMode, recordMatchOutcome, showAchievementToast])

  // ─── Floating UI placement ─────────────────────────────────────────────────
  // Back/settings chips and the Game Over/quit-confirm cards all live OUTSIDE the board's own
  // rotated container (see the JSX below), so each is individually positioned/rotated via
  // rotationDeg rather than inheriting the container's own transform - same technique Pong's game
  // screen uses for its own floating chips.
  //
  // localToScreen's containerWidth/Height MUST be localSize.width/height (the pre-rotation
  // container's own S×L size - always portrait-shaped, per computeLocalContainerSize's own doc),
  // NOT logicalWidth/logicalHeight: board.x/y live in that same S×L local frame (computeBoardLayout
  // returns board.width as S, board.height as L - see utils/board.ts), and it's THAT view, sized to
  // localSize and centered in the real viewport, that rotationDeg actually rotates - confirmed by
  // reproducing the original bug in the browser preview (using logicalWidth/Height here sent the
  // back chip well off-screen once desktop web's letterboxing made S×L diverge from
  // logicalWidth×logicalHeight).
  const buttonMargin = 16
  // With Settings.rink off on a screen with no top inset, the field starts right at the screen's
  // edge, so the chips (24px half-height) are held 4px clear of it rather than hanging off-screen.
  const buttonY = Math.max(board.y, 12) + buttonMargin
  const backPos = localToScreen(board.x + buttonMargin, buttonY, localSize.width, localSize.height, screenCenterX, screenCenterY, rotationDeg)
  const settingsPos = localToScreen(board.x + board.width - buttonMargin, buttonY, localSize.width, localSize.height, screenCenterX, screenCenterY, rotationDeg)
  const rotationStyle = rotationDeg !== 0 ? { transform: [{ rotate: `${rotationDeg}deg` }] } : undefined
  // Desktop web turns the rink a quarter turn to fit a wide window, but the page itself is always
  // read upright there, so the back/settings chips, the Game Over card and the dialogs stay upright
  // too rather than turning with it. The chips also leave the rink for the page's own top corners,
  // the same spot as hud's CornerActionButtons on every other screen; following the rink would carry
  // them down the page's left edge.
  const overlayRotationDeg = isDesktopWeb ? 0 : rotationDeg
  const overlayRotationStyle = isDesktopWeb ? undefined : rotationStyle
  const backSlot = isDesktopWeb ? { top: 8 + insets.top, left: 8 + insets.left } : { left: backPos.x - 24, top: backPos.y - 24 }
  const settingsSlot = isDesktopWeb ? { top: 8 + insets.top, right: 8 + insets.right } : { left: settingsPos.x - 24, top: settingsPos.y - 24 }

  const progressMessage = (
    <>
      <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
      <Text style={{ color: fgMuted }}> - </Text>
      <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
    </>
  )
  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* Local-space board + input area - sized to localSize (the container BEFORE rotation,
          covering the whole screen so the rink pocket can reach into the safe-area insets; the
          board geometry keeps the playing field itself inside them), centered on the screen,
          then rotated ±90° for side-by-side
          landscape so the SAME canonical local geometry (see GoalSide's own doc comment) maps
          onto a wide screen correctly. Board's Skia canvas is written purely in local
          coordinates and never branches on goalAxis at all - DOM/native hit-testing correctly
          respects this rotation when deciding which zone a touch lands on, so TouchInputLayer's
          two zones don't need to branch on axis either. Only the touch's own COORDINATE VALUE
          needs explicit handling: TouchInputLayer converts e.absoluteX/Y back into local space
          itself (see its own screenToLocal comment for why - verified in the browser preview
          that react-native-gesture-handler's web e.x/e.y do NOT correctly invert an ancestor's
          CSS rotation the way native touch delivery would), which is why it needs
          screenCenterX/Y and rotationDeg passed in below, matching this same rotation exactly.
          Rotation direction confirmed empirically in the browser preview (a hand-derived
          clockwise/counter-clockwise expectation didn't match RN-web's actual rotate() sign, so
          this is calibrated against the real render, not re-derived from theory): '90deg' puts
          player 1 (local bottom) on the screen's RIGHT, '-90deg' puts them on the LEFT. */}
      <View style={[styles.viewport, { width, height }]}>
        <View style={[styles.localContainer, { width: localSize.width, height: localSize.height }, rotationDeg !== 0 && { transform: [{ rotate: `${rotationDeg}deg` }] }]}>
          <Board board={board} puck={puck} paddles={paddles} phase={phase} scores={scores} scoreToWin={scoreToWin} lastScoredGoal={lastScoredGoal} goalDoorHitCount={goalDoorHitCount} lastGoalDoorSide={lastGoalDoorSide} showWalls={isDesktopWeb} />
          {/* Zones themselves still live inside this same rotated container - DOM/native hit-
              testing needs their rotated screen footprint to correctly decide WHICH zone a touch
              landed on; only the resulting coordinate VALUE (screenToLocal, using
              screenCenterX/Y + rotationDeg below) needs the explicit, non-rotation-relative fix. */}
          <TouchInputLayer humanPlayers={humanPlayers} enabled={!paused} localWidth={localSize.width} localHeight={localSize.height} screenCenterX={screenCenterX} screenCenterY={screenCenterY} rotationDeg={rotationDeg} onPaddleTarget={setPaddleTarget} />
        </View>
      </View>

      {/* Web-only, additive keyboard input - see that component's own doc for why it needs no
      rotation-awareness the way TouchInputLayer does. paddles[1]/paddles[2] are read fresh every
      frame internally (not reactively), so passing the current `paddles` snapshot here on every
      render is exactly right, not stale. */}
      <KeyboardInputLayer enabled={!paused} humanPlayers={humanPlayers} controlScheme={roundSettings.controlScheme} paddlePos={{ 1: paddles[1], 2: paddles[2] }} onPaddleTarget={setPaddleTarget} />

      {/* Game Over overlay - card rotates as a unit via rotationDeg so it reads upright whichever
          way the board itself is currently rotated (see rotationStyle above), matching Pong's own
          Game Over card; previously left unrotated. Upright on desktop web (see overlayRotationDeg). */}
      {phase === 'gameOver' && (
        <OverlayBackdrop>
          <OverlayCard style={overlayRotationStyle}>
            <Icon source='trophy' size={64} color={playerColor[winner]} />
            <Text variant='headlineLarge' style={[styles.overlayTitle, { color: playerColor[winner], fontFamily: MONO_FONT }]}>
              Wins!
            </Text>
            <Text variant='bodyLarge' style={[styles.overlayScore, { fontFamily: MONO_FONT }]}>
              <Text style={{ color: playerColor[1] }}>{scores[0]}</Text>
              <Text style={{ color: fgMuted }}> - </Text>
              <Text style={{ color: playerColor[2] }}>{scores[1]}</Text>
            </Text>
            {/* Two-player-only achievement rows - see seatUnlocks' own doc above for why these land
            here instead of the shared showAchievementToast vsCpu still uses. This card already
            carries a single shared rotationStyle, so each row's owner avatar is what identifies
            whose achievement it is, not a second independent rotation. */}
            {aiPlayer === null && <AchievementUnlockList unlocks={seatUnlocks} seats={SEATS} owners={achievementOwners} tierColors={ACHIEVEMENT_TIER_COLORS} fg={cardFg} />}
            <Button mode='contained' onPress={() => resetGame(board)} style={styles.overlayButton} buttonColor={playerColor[loser]} textColor={playerOnColor[loser]}>
              Play Again
            </Button>
            <Button mode='contained' onPress={safeBack} style={styles.overlayButton} buttonColor={playerColor[winner]} textColor={playerOnColor[winner]}>
              Quit
            </Button>
          </OverlayCard>
        </OverlayBackdrop>
      )}

      {/* Quit confirmation - now the fleet-shared @tastic/hud ConfirmDialog rather than a hand-
      rolled overlay. Its rotation is the same physical-hold-compensating rotation the board/other
      floating UI use (see rotationDeg's own comment above), not a fresh computation, except that
      desktop web keeps it upright (see overlayRotationDeg).
      Trades this dialog's previous secondary-accent Quit button and MONO_FONT styling for the
      shared component's primary accent and default font - an accepted trade-off. */}
      <ConfirmDialog visible={confirmVisible} title='Quit Match?' message={progressMessage} confirmLabel='Quit' cancelLabel='Cancel' icon='alert-circle-outline' destructive={false} onConfirm={safeBack} onCancel={cancelBack} rotation={overlayRotationDeg} />
      {/* Shown when the app comes back from the background mid-match (see useBackgroundPause above):
      play stays frozen until Resume, so a match never restarts before the player is back and ready. */}
      <ConfirmDialog visible={backgroundPaused} title='Paused' message={progressMessage} confirmLabel='Resume' cancelLabel='Quit' icon='pause-circle-outline' destructive={false} onConfirm={resume} onCancel={safeBack} rotation={overlayRotationDeg} />

      {/* Back + settings - anchored to the board's own top corners in LOCAL space (board.x/y), then
          mapped to a real screen position via localToScreen using the SAME rotationDeg the board's
          own container above is rotated by, so the pair travels (not just spins) to track wherever
          the board's rotated top edge actually lands on screen - same technique Pong's own
          back/settings chips use. Previously pinned to the real screen's raw top-left/top-right
          (insets.top/left/right, never rotated or moved): correct only at rotationDeg 0; once
          goalAxis flipped to 'horizontal' the board spun ±90° underneath while these stayed put,
          landing in the wrong corner relative to the now-rotated board and never turning to stay
          legible. Unlike BoxHockey's centerline placement (needed there because its board splits
          face-to-face with P2's half rotated 180°), AirHockey's board is never rotated PER PLAYER -
          only as a single unit for goalAxis - so one shared, non-neutral corner pair is still
          correct; it just has to move and rotate with that unit rotation instead of ignoring it.
          Desktop web is the exception: the page's own top corners, upright (see overlayRotationDeg above). */}
      <View style={[styles.backButton, backSlot]}>
        <IconButton icon='arrow-left' iconColor={bg} containerColor={fg} style={[styles.chipButton, overlayRotationStyle]} size={24} onPress={requestBack} accessibilityLabel='Back' />
      </View>
      <View style={[styles.settingsButton, settingsSlot]}>
        <IconButton icon='cog' iconColor={bg} containerColor={fg} style={[styles.chipButton, overlayRotationStyle]} size={24} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />
      </View>

      {/* Same physical-hold-compensating rotation the board itself uses (see rotationDeg's own
      comment above, and overlayRotationDeg for desktop web), not a separate reading; previously omitted entirely,
      leaving this dialog's content stuck unrotated in the 'horizontal' goalAxis orientation while
      index.tsx/loadout.tsx's own dialogs correctly rotated. */}
      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={overlayRotationDeg} settings={settings} setSettings={setSettings} />
    </View>
  )
}

const styles = StyleSheet.create({
  backButton: { position: 'absolute' },
  chipButton: { margin: 0 },
  // Deliberately NOT position: 'absolute' - it needs to stay a normal flex child of `viewport`
  // so that parent's alignItems/justifyContent: 'center' actually centers it (an absolutely
  // positioned child ignores its parent's flex alignment entirely and defaults to pinning at
  // (0,0) instead, which is what silently put the whole board off-center before this was caught
  // in the browser preview).
  localContainer: {},
  overlayButton: { width: 160 },
  overlayScore: {},
  overlayTitle: { fontWeight: 'bold' },
  root: { flex: 1 },
  settingsButton: { position: 'absolute' },
  viewport: { alignItems: 'center', justifyContent: 'center', left: 0, position: 'absolute', top: 0 }
})
