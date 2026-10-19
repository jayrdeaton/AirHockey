import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { FakeLandscapeView, getViewRotation, rotateInsets, useOrientationState } from '@tastic/core'
import { ControlSchemePicker, CornerActionButtons, MenuOption, PlayerSetupPanel, PressAwayOverlay, ReadyButton, SharedActionBand, usePopoverHost } from '@tastic/hud'
import { assignSeatScheme } from '@tastic/input'
import { avoidSeatColorClash, Profile, profileSeatColor } from '@tastic/profile'
import { DualZoneLayout, needsSharedNeutralZone, useDualZoneLayout } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import { useProfiles } from '@/hooks/useProfiles'
import { useSettings } from '@/hooks/useSettings'
import { liveplayActions } from '@/redux/liveplaySlice'
import { seatColorsActions } from '@/redux/seatColorsSlice'
import { DEFAULT_SETTINGS } from '@/redux/settingsSlice'
import type { AppDispatch, RootState } from '@/redux/store'
import { ControlScheme, FrictionLevel, PaddleSizeLevel, Player, PuckSizeLevel } from '@/types'
import { AIDifficulty } from '@/utils/aiOpponent'
import { humanPlayersFor, parseGameMode } from '@/utils/gameMode'
import { safeBack } from '@/utils/navigation'

// BoxHockey's own constants/game.ts owns LOADOUT_PANEL_SWAP_FADE_MS, but AirHockey's version of
// that file is owned by the physics/board work happening elsewhere in this build - kept local here
// instead of adding to it, same 180ms BoxHockey itself uses for this exact fade.
const PANEL_SWAP_FADE_MS = 180

// What @tastic/profile's avoidSeatColorClash moves seat 2 to when both seats land on one color: a
// profile picked for one seat can be saved as the other seat's color, with no swap step behind it.
const SEAT_DEFAULT_COLORS = [DEFAULT_P1_COLOR, DEFAULT_P2_COLOR] as const

// The rink toggle's single option, same as BoxHockey's RINK_OPTION: presence in a one-item
// multi-select's value array already means "on," so there's nothing an "off" row would add beyond
// what tapping the "on" row a second time (to un-toggle it) already does.
const RINK_OPTION: MenuOption<'on'> = { value: 'on', label: 'Rink', description: 'Rounded corners + net pocket', icon: 'rounded-corner' }

const FRICTION_OPTIONS: MenuOption<FrictionLevel>[] = [
  { value: 'high', label: 'Slow', description: 'Puck stops quickly', icon: 'speedometer-slow' },
  { value: 'medium', label: 'Medium', description: 'Standard glide', icon: 'speedometer-medium' },
  { value: 'low', label: 'Fast', description: 'Puck glides farther', icon: 'speedometer' }
]

// Rewritten from BoxHockey's own puck-size descriptions, which referenced divider gaps that don't
// exist here - AirHockey's puck size instead scales the goal mouth itself (goal width is derived
// from puck+paddle radii - see GOAL_OPEN_FRACTION in constants/game.ts), so it's a
// forgiveness/difficulty knob on scoring rather than a squeeze-through one.
const PUCK_SIZE_OPTIONS: MenuOption<PuckSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Narrower goals, harder to score', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Wider goals, easier to score', icon: 'circle-outline' }
]

// New relative to BoxHockey - the paddle now physically collides with the puck (see
// applyPaddleCollision in utils/physics.ts), so its size is a real defense/precision knob, not just
// cosmetic. Same size-tier option shape as PUCK_SIZE_OPTIONS above.
const PADDLE_SIZE_OPTIONS: MenuOption<PaddleSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Smaller mallet, more precision', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Bigger mallet, easier defense', icon: 'circle-outline' }
]

const SCORE_TO_WIN_OPTIONS: MenuOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

// aiOpponent.ts (already ported, untouched) has no AI_DIFFICULTY_LABELS export of its own - unlike
// BoxHockey's version, it only exports the AIDifficulty type and the pure tuning function - so the
// labels live here instead, same three tiers.
const AI_DIFFICULTY_OPTIONS: MenuOption<AIDifficulty>[] = [
  { value: 'easy', label: 'Easy', icon: 'emoticon-happy-outline' },
  { value: 'medium', label: 'Medium', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'Hard', icon: 'emoticon-devil-outline' }
]

// Left icon-less, mirroring Snake's/Pong's own CONTROL_SCHEME_OPTIONS exactly - there's no
// MaterialCommunityIcons glyph that reads as "WASD" or "IJKL" at a glance the other option lists
// above get from their icons, so mixing one iconned option (Mouse) in with four icon-less ones
// would look like an inconsistency rather than a real distinction.
const CONTROL_SCHEME_OPTIONS: MenuOption<ControlScheme>[] = [
  { value: 'mouse', label: 'Mouse' },
  { value: 'wasd', label: 'WASD' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'ijkl', label: 'IJKL' },
  { value: 'numpad', label: 'Numpad' }
]

function pickRandom<T>(options: readonly { value: T }[]): T {
  return options[Math.floor(Math.random() * options.length)].value
}

export default function LoadoutScreen() {
  // Read only from this screen's own route param, never from useSettings().settings.gameMode:
  // the route param is the mode this screen was opened for (settings.gameMode is only the last mode
  // saved).
  const params = useLocalSearchParams<{ mode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.mode), [params.mode])
  const humanPlayers = useMemo(() => humanPlayersFor(gameMode), [gameMode])

  const { settings, setSettings } = useSettings()
  const { profiles, lastSelected, selectProfile } = useProfiles()
  // orientationMode just follows the device's own physical tilt (see useOrientationState),
  // CPU games included - how you're holding the phone right now decides the panel arrangement,
  // not a stored per-round choice. This is what lets two players sit shoulder-to-shoulder and pick
  // a color at the same time once the phone is turned sideways, instead of a portrait-narrow
  // column - and for vs-CPU, it's simply whichever way the solo player is holding it. Lock
  // Orientation (see SettingsDialog) is the opt-in for pinning it, app-wide: it freezes the shared
  // reading itself (see OrientationBridge in _layout.tsx), so nothing is passed here.
  const { orientationMode, p1OnRight, upsideDown, resolved: p1OnRightResolved } = useOrientationState()

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight/upsideDown above - see useDualZoneLayout's own
  // comment. Also drives the solo (vs-CPU) branch's own row below - that one doesn't rotate anyone
  // 180°, but still reorders/fades across a portrait<->landscape change the same way.
  //
  // On a phone, 2 Player stays face-to-face however it's held: P1 in the bottom half, P2 in the top
  // half, the same split /game plays 2 Player on there (see its goalAxis), so each player gets the
  // same half of the phone here and in the match. Following the tilt used to put P1 at the phone's
  // top end (landscape or upside down) and then move them on Ready. Web follows the window here and
  // in /game alike.
  const fixedSeats = gameMode === 'twoPlayer' && Platform.OS !== 'web'
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(fixedSeats ? 'faceToFace' : orientationMode, fixedSeats ? true : p1OnRight, fixedSeats || p1OnRightResolved, fixedSeats ? false : upsideDown, PANEL_SWAP_FADE_MS)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) - rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated, using the same committed
  // rotation FakeLandscapeView itself renders with, so `top`/`left`/`right` below always mean the
  // screen's real, visual edges regardless of how the phone is being held.
  const rotation = getViewRotation(panelLayout.orientationMode, panelLayout.p1OnRight, panelLayout.upsideDown)
  const rotatedInsets = rotateInsets(useSafeAreaInsets(), rotation)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // CPU always plays P2 (see useAIOpponent's own comment) - needed above the profile/guest/CPU
  // color logic below, not just the panel wiring further down.
  const p2IsHuman = humanPlayers.includes(2)
  const p1Profile = profiles.find((p) => p.id === lastSelected[1]) ?? null
  const p2Profile = p2IsHuman ? (profiles.find((p) => p.id === lastSelected[2]) ?? null) : null

  // This screen's own memory for a human seat with no profile selected, and (separately) for
  // vs-CPU's own CPU seat - see redux/seatColorsSlice.ts's own doc for why these are two distinct
  // fields rather than one. Backed by Redux (persisted via redux-persist same as every other slice)
  // rather than the two dedicated AsyncStorage keys this used to read/write - PersistGate (see
  // Providers.tsx) already blocks this screen from mounting until rehydration completes, so unlike
  // the old async-loaded version there's no "still loading" gap to guard the reconciliation effect
  // below against.
  const dispatch = useDispatch<AppDispatch>()
  const guestColors = useSelector((state: RootState) => state.seatColors.lastGuestColor)
  const cpuColor = useSelector((state: RootState) => state.seatColors.lastCpuColor)
  // Each profile's own color pick in AirHockey, by profile id, read through @tastic/profile's
  // profileSeatColor (see createSeatColorsSlice's doc). Persisted through Redux the same as
  // guestColors/cpuColor above. It follows the profile, not the seat: kept through a switch to
  // another profile and back, a move to the other seat, and a relaunch.
  const profileColors = useSelector((state: RootState) => state.seatColors.profileColors)

  // Kept in sync via their own trivial effects (never read during render, only written) purely so
  // the focus-reset effect below can read each seat's CURRENT resolved profile / persisted guest /
  // persisted CPU color / persisted profile picks without listing profiles/guestColors/cpuColor/
  // profileColors themselves as its own dependencies - profiles is a brand new array from
  // useProfiles() on every one of its own re-renders, and depending on any of these reactively
  // there would re-fire that effect (see useFocusEffect's own re-run semantics: it re-invokes its
  // callback immediately, while still focused, whenever the callback's identity changes) merely
  // because one of them changed while this screen stays continuously focused. Matches BoxHockey's/
  // Snake's identical fix for the same "editing a profile's color elsewhere doesn't repaint
  // /loadout until something else also happens to change" bug.
  const p1ProfileRef = useRef(p1Profile)
  const p2ProfileRef = useRef(p2Profile)
  const guestColorsRef = useRef(guestColors)
  const cpuColorRef = useRef(cpuColor)
  const profileColorsRef = useRef(profileColors)
  useEffect(() => {
    p1ProfileRef.current = p1Profile
  }, [p1Profile])
  useEffect(() => {
    p2ProfileRef.current = p2Profile
  }, [p2Profile])
  useEffect(() => {
    guestColorsRef.current = guestColors
  }, [guestColors])
  useEffect(() => {
    cpuColorRef.current = cpuColor
  }, [cpuColor])
  useEffect(() => {
    profileColorsRef.current = profileColors
  }, [profileColors])

  // Keeps the live (whole-app) theme in sync with each seat's own color SOURCE, re-deriving it any
  // time either seat's identity changes: mount, a fresh profile pick, clearing back to guest,
  // switching game modes, or a recolor persisting a new remembered value into Redux (see
  // persistGuestColors/persistCpuColor and the setProfileColor dispatches in
  // handleP1ColorChange/handleP2ColorChange below - all of them land in guestColors/cpuColor/
  // profileColors above, which are this effect's own deps). A profile-selected seat shows that
  // profile's pick in AirHockey, or its CURRENT .color without one (profileSeatColor) - a pick
  // belongs to the profile, so it follows it to whichever seat it's on; otherwise it falls back to
  // this seat's own guest/CPU slot. One combined effect (not one per seat) since two independent
  // setThemeColor calls would each overwrite the other's just-applied color with a stale snapshot
  // of it - `color` is a whole {primary, secondary, tertiary} triad, not a per-seat patch. Manual recolors/
  // clash-swaps (handleP1ColorChange/handleP2ColorChange below) don't touch this effect's own deps
  // in the same tick - setThemeColor already repaints immediately, so this effect only catches up
  // afterward, once their own persist call round-trips through Redux, recomputing the same values
  // it already applied (harmless, idempotent).
  useEffect(() => {
    const nextP1 = p1Profile ? profileSeatColor(p1Profile, profileColors) : guestColors[1]
    const nextP2 = avoidSeatColorClash(nextP1, !p2IsHuman ? cpuColor : p2Profile ? profileSeatColor(p2Profile, profileColors) : guestColors[2], SEAT_DEFAULT_COLORS)
    setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected[1], lastSelected[2], p2IsHuman, guestColors, cpuColor, profileColors])

  // /loadout pushes /game and /profiles on top of itself and returns to this same screen via
  // router.back()/safeBack() - a pop that reveals this SAME, still-mounted instance rather than a
  // fresh mount (see the `ready`-reset useFocusEffect below, which exists for the same reason). The
  // reactive effect above only re-fires when lastSelected/guestColors/cpuColor/profileColors
  // themselves change - editing a currently-selected profile's own saved color via Manage Profiles
  // touches none of those (that profile's id stays selected the whole time), so without this,
  // returning here left the paddle showing that profile's now-stale color until something else
  // happened to also change. On every genuine focus regain - initial mount, and returning here from
  // /game or /profiles - re-derive each seat's live color from its authoritative source (profile /
  // guest / CPU, honoring a profile's pick), reading profiles/guestColors/cpuColor/
  // profileColors through the refs above instead of depending on them directly so this doesn't
  // also re-fire on every one of their changes while this screen stays continuously focused (see
  // the refs' own comment above).
  useFocusEffect(
    useCallback(() => {
      const p1Prof = p1ProfileRef.current
      const p2Prof = p2ProfileRef.current
      const guest = guestColorsRef.current
      const cpu = cpuColorRef.current
      const picks = profileColorsRef.current
      const nextP1 = p1Prof ? profileSeatColor(p1Prof, picks) : guest[1]
      const nextP2 = avoidSeatColorClash(nextP1, !p2IsHuman ? cpu : p2Prof ? profileSeatColor(p2Prof, picks) : guest[2], SEAT_DEFAULT_COLORS)
      setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastSelected[1], lastSelected[2], p2IsHuman, setThemeColor])
  )

  const persistGuestColors = useCallback(
    (patch: Partial<Record<Player, string>>) => {
      if (patch[1] !== undefined) dispatch(seatColorsActions.setLastGuestColor({ seat: 1, color: patch[1] }))
      if (patch[2] !== undefined) dispatch(seatColorsActions.setLastGuestColor({ seat: 2, color: patch[2] }))
    },
    [dispatch]
  )
  const persistCpuColor = useCallback((hex: string) => dispatch(seatColorsActions.setLastCpuColor(hex)), [dispatch])

  // Picking the other slot's exact current color swaps the two instead of no-op'ing - only
  // reachable at all when that slot's own picker allowed it (allowSwapTaken: vs-CPU only, where
  // the "other" color there is only ever the CPU's, not a second real person's choice). Each side's
  // resulting color persists to whichever slot that seat currently owns: the selected profile's
  // pick in AirHockey for a profile-selected seat (the "AirHockey only" caption on the Color row -
  // that profile's own saved .color is never touched by this, and picking it again drops the pick),
  // this seat's own guest slot for a human with no profile selected, or the CPU slot for vs-CPU's
  // own seat - independently of the other seat, so a clash-swap between e.g. a CPU seat and a guest
  // seat updates each one's own remembered color.
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const nextP2 = hex.toLowerCase() === p2Color.toLowerCase() ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
      if (p1Profile) dispatch(seatColorsActions.setProfileColor({ profile: p1Profile, color: hex }))
      else persistGuestColors({ 1: hex })
      if (nextP2 !== p2Color) {
        if (!p2IsHuman) persistCpuColor(nextP2)
        else if (p2Profile) dispatch(seatColorsActions.setProfileColor({ profile: p2Profile, color: nextP2 }))
        else persistGuestColors({ 2: nextP2 })
      }
    },
    [setThemeColor, p1Color, p2Color, p1Profile, p2Profile, p2IsHuman, persistGuestColors, persistCpuColor, dispatch]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const nextP1 = hex.toLowerCase() === p1Color.toLowerCase() ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
      if (!p2IsHuman) persistCpuColor(hex)
      else if (p2Profile) dispatch(seatColorsActions.setProfileColor({ profile: p2Profile, color: hex }))
      else persistGuestColors({ 2: hex })
      if (nextP1 !== p1Color) {
        if (p1Profile) dispatch(seatColorsActions.setProfileColor({ profile: p1Profile, color: nextP1 }))
        else persistGuestColors({ 1: nextP1 })
      }
    },
    [setThemeColor, p1Color, p2Color, p1Profile, p2Profile, p2IsHuman, persistGuestColors, persistCpuColor, dispatch]
  )

  // A seat's color follows its newly selected profile through the reactive effect above (its pick,
  // or its own color), keyed on lastSelected. Picking the other seat's profile swaps the two (see
  // @tastic/profile's select), and each keeps its own pick, since a pick belongs to the profile, not
  // the seat. Reselecting the seat's current profile changes nothing, so its pick stays.
  const handleP1ProfileSelect = useCallback((profile: Profile | null) => selectProfile(1, profile?.id ?? null), [selectProfile])
  const handleP2ProfileSelect = useCallback((profile: Profile | null) => selectProfile(2, profile?.id ?? null), [selectProfile])

  // Covers exactly the fields LoadoutSharedControls itself exposes - puck/paddle physics, score to
  // win, and (vs-CPU only) AI difficulty, since that picker also lives in this shared row rather
  // than a per-player panel the way LightCycles' cpuDifficulty does. Per-player stuff (colors) and
  // app-wide prefs (lock orientation) live outside this row and aren't "match settings" in the
  // sense a player means when they ask to shuffle or reset the current round. Matches BoxHockey's
  // identically-shaped handlers.
  const handleRandomizeMatchSettings = useCallback(() => {
    setSettings({
      rink: Math.random() < 0.5,
      friction: pickRandom(FRICTION_OPTIONS),
      puckSize: pickRandom(PUCK_SIZE_OPTIONS),
      paddleSize: pickRandom(PADDLE_SIZE_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      ...(gameMode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, gameMode])

  const handleResetMatchSettings = useCallback(() => {
    setSettings({
      rink: DEFAULT_SETTINGS.rink,
      friction: DEFAULT_SETTINGS.friction,
      puckSize: DEFAULT_SETTINGS.puckSize,
      paddleSize: DEFAULT_SETTINGS.paddleSize,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      ...(gameMode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, gameMode])

  const [ready, setReady] = useState<Record<Player, boolean>>({ 1: false, 2: false })

  // Every time this screen (re)gains focus - first arrival from the title screen, or coming back
  // here via the post-game "Loadout" button - Ready starts false again. Without this, popping back
  // to an already-mounted loadout whose players both left it Ready would immediately re-trigger the
  // all-ready effect below and bounce straight back into /game.
  useFocusEffect(
    useCallback(() => {
      setReady({ 1: false, 2: false })
    }, [])
  )

  // Read through a ref rather than listed as a dependency of the effect below: this screen stays
  // mounted (and still all Ready) under /game, so a settings change made there (toggling Lock
  // Orientation or Edge Guard in /game's Settings dialog, or the lock recording its angle) would
  // otherwise re-run that effect and push a second /game.
  const settingsRef = useRef(settings)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    if (!humanPlayers.every((p) => ready[p])) return
    // `gameMode` (this screen's own route param), not settings.gameMode: the route param is the mode
    // this loadout was opened for.
    dispatch(liveplayActions.setActiveRoundSettings({ ...settingsRef.current, gameMode }))
    router.push('/game')
  }, [ready, humanPlayers, gameMode, dispatch])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const isPortrait = panelLayout.orientationMode === 'faceToFace'
  // See @tastic/split-screen's needsSharedNeutralZone for the full reasoning - extracted there
  // once this exact boolean turned up independently hand-duplicated across LightCycles/BoxHockey/
  // Snake too.
  const showMetaInSharedBand = needsSharedNeutralZone(panelLayout.orientationMode, humanPlayers.length)

  // Where P2's own press-away zone lives on screen - matches panelLayout (the already-committed,
  // currently-painted layout), not the live orientationMode/p1OnRight, since it needs to agree with
  // whichever arrangement is actually on screen right now, mid-fade included. Portrait always
  // renders P2's panel in the top half (see DualZoneLayout below); landscape puts it on whichever
  // side panelLayout.p1OnRight says isn't P1's. Only meaningful in two-player mode - vsCpu's P2/CPU
  // slot shares controlsHost instead (see p2Host below), so it never needs a zone of its own.
  const p2ZoneStyle = gameMode === 'twoPlayer' ? (isPortrait ? styles.p2ZoneTop : panelLayout.p1OnRight ? styles.p2ZoneLeft : styles.p2ZoneRight) : null

  // Vs-CPU only has one human slot, so its Ready toggle renders standalone below both panels
  // instead of embedded in this panel.
  const showReadyButton = gameMode === 'twoPlayer'
  // P1's own panel and the shared controls row always share one host - mutually exclusive
  // regardless of game mode, since both sit in the same near/bottom zone. Vs-CPU additionally
  // folds P2/CPU's panel into this same host: only one human is ever driving both slots there, so
  // having both YOU's and CPU's popovers open at once is just clutter. Two-player mode keeps P2 on
  // its own independent host, since two real people editing at once is the whole point there -
  // loadout.tsx (rather than PlayerSetupPanel's own internal fallback) owns it explicitly so the
  // press-away zones below can close it without a P1-side tap ever reaching into P2's own popover,
  // or vice versa.
  const controlsHost = usePopoverHost()
  const p2PanelHost = usePopoverHost()
  const p2Host = gameMode === 'vsCpu' ? controlsHost : p2PanelHost
  // Vs-CPU's own standalone Ready button (below, not per-panel - see showReadyButton) is centered
  // under the whole row, not under either player's own trigger, so it doesn't share a center with
  // an open popover the way a two-player panel's *embedded* Ready button does. A side player's
  // popover is centered on that player's own (off-center) trigger instead, so it can't fully cover
  // the wider gap between its edge and the standalone button's - leaving a sliver of the button's
  // own border peeking out from beside/behind the popover. Faded out instead while any player's
  // popover is open, rather than trying to reconcile the two different centers.
  const anyPlayerPickerOpen = !!(controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-'))

  const sharedControlsRow = (
    <LoadoutSharedControls
      host={controlsHost}
      rink={settings.rink}
      rinkOption={RINK_OPTION}
      onRinkChange={(value) => setSettings({ rink: value })}
      friction={settings.friction}
      frictionOptions={FRICTION_OPTIONS}
      onFrictionChange={(value) => setSettings({ friction: value })}
      puckSize={settings.puckSize}
      puckSizeOptions={PUCK_SIZE_OPTIONS}
      onPuckSizeChange={(value) => setSettings({ puckSize: value })}
      paddleSize={settings.paddleSize}
      paddleSizeOptions={PADDLE_SIZE_OPTIONS}
      onPaddleSizeChange={(value) => setSettings({ paddleSize: value })}
      scoreToWin={settings.scoreToWin}
      scoreToWinOptions={SCORE_TO_WIN_OPTIONS}
      onScoreToWinChange={(value) => setSettings({ scoreToWin: value })}
      // Omitted (leaving LoadoutSharedControls' own actionsRow unrendered) whenever
      // showMetaInSharedBand is about to fold randomize/reset into its own merged header row
      // instead - otherwise both would render at once.
      onRandomize={showMetaInSharedBand ? undefined : handleRandomizeMatchSettings}
      onReset={showMetaInSharedBand ? undefined : handleResetMatchSettings}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  // Only wrapped for showMetaInSharedBand (see its own comment above) - everywhere else back/
  // settings stay in their usual top corners (CornerActionButtons below) and randomize/reset stay
  // in LoadoutSharedControls' own row above the trigger gauges. SharedActionBand owns the "is the
  // open popover actually one of mine" self-elevation check internally, given just the resolved
  // boolean below.
  const sharedControlsPopoverOpen = controlsHost.openId !== null && LOADOUT_SHARED_CONTROLS_IDS.includes(controlsHost.openId)
  const sharedControls = showMetaInSharedBand ? (
    <SharedActionBand onBack={safeBack} onSettings={() => setSettingsOpen(true)} onRandomize={handleRandomizeMatchSettings} onReset={handleResetMatchSettings} fg={fg} popoverOpen={sharedControlsPopoverOpen}>
      {sharedControlsRow}
    </SharedActionBand>
  ) : (
    sharedControlsRow
  )

  // ControlSchemePicker itself gates out to null on native/touch-primary (see that component's own
  // doc) - rendered unconditionally into secondPicker below rather than this screen re-deriving that
  // same Platform/touch check, same as the old local PlayerSetupPanel used to do internally.
  const p1ControlSchemePicker = <ControlSchemePicker id='p1-controls' host={controlsHost} value={settings.controlScheme[1]} onChange={(scheme) => setSettings({ controlScheme: assignSeatScheme(settings.controlScheme, 1, scheme) })} options={CONTROL_SCHEME_OPTIONS} takenValue={p2IsHuman ? settings.controlScheme[2] : undefined} accentColor={p1Color} mutedColor={fgMuted} dark={dark} />
  // Each seat is one button opening one dropdown (a Color row, then the profiles or the CPU's
  // difficulty levels), which PlayerSetupPanel places itself with useZoneClampedAlign, so it stays
  // inside that player's own half in two-player mode. The "AirHockey only" caption shows on the
  // Color row only while a profile is selected: a pick there is that profile's in this game only
  // (see handleP1ColorChange above).
  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} colorCaption='AirHockey only' isHuman secondPicker={p1ControlSchemePicker} secondPickerId='p1-controls' ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} profiles={profiles} selectedProfileId={lastSelected[1]} takenProfileId={p2IsHuman ? lastSelected[2] : null} guestLabel='P1' onProfileSelect={handleP1ProfileSelect} onManageProfiles={() => router.push('/profiles')} />
  const p2ControlSchemePicker = p2IsHuman ? <ControlSchemePicker id='p2-controls' host={p2Host} value={settings.controlScheme[2]} onChange={(scheme) => setSettings({ controlScheme: assignSeatScheme(settings.controlScheme, 2, scheme) })} options={CONTROL_SCHEME_OPTIONS} takenValue={settings.controlScheme[1]} accentColor={p2Color} mutedColor={fgMuted} dark={dark} /> : undefined
  const p2Panel = <PlayerSetupPanel idPrefix='p2' host={p2Host} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} colorCaption='AirHockey only' isHuman={p2IsHuman} secondPicker={p2ControlSchemePicker} secondPickerId={p2IsHuman ? 'p2-controls' : undefined} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} profiles={p2IsHuman ? profiles : undefined} selectedProfileId={lastSelected[2]} takenProfileId={lastSelected[1]} guestLabel='P2' onProfileSelect={p2IsHuman ? handleP2ProfileSelect : undefined} cpuDifficulty={p2IsHuman ? undefined : settings.aiDifficulty} cpuDifficultyOptions={p2IsHuman ? undefined : AI_DIFFICULTY_OPTIONS} onCpuDifficultyChange={p2IsHuman ? undefined : (value: AIDifficulty) => setSettings({ aiDifficulty: value })} />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held -
      see @tastic/core's FakeLandscapeView for why this is needed at all now that the app
      is portrait-locked at the OS level (no more real OS rotation to rely on). Driven by
      panelLayout (the same committed, already-fade-masked state DualZoneLayout itself renders
      from), not the live orientationMode/p1OnRight/upsideDown above, so the visual rotation change
      and the panel swap/reorder always land in the same fade-covered moment instead of one
      snapping ahead of the other. SettingsDialog is deliberately left outside this wrapper - it
      renders as a centered modal overlay, unaffected by (and not needing) this transform. */}
      <FakeLandscapeView orientationMode={panelLayout.orientationMode} p1OnRight={panelLayout.p1OnRight} upsideDown={panelLayout.upsideDown} style={styles.rotatable}>
        {/* Press-away overlays for the loadout screen's own popovers (seat dropdowns, shared-setting
        dropdowns) - see PressAwayOverlay's own comment for the paint-order trick that keeps real
        controls directly tappable. P1's covers the whole screen (their own panel plus every shared
        setting reads as "theirs" - see LoadoutSharedControls), while P2's is scoped to just their
        own half (p2ZoneStyle) and, being a later sibling, takes priority over P1's within that rect.

        P2's overlay has to mount whenever *either* host has something open, not just p2Host - P1's
        popover being open is exactly when P1's full-screen overlay is sitting underneath P2's zone
        too, and if P2's own overlay were absent then (p2Host closed), a tap anywhere on P2's side
        would fall straight through to P1's and close P1's dialog. Mounting it any time controlsHost
        is open too - even though its own onPress (p2Host.close) is then a no-op - makes it "shield"
        P2's zone from P1's overlay unconditionally, which is what actually keeps P2's side exempt
        from P1's press-away regardless of whether P2 has anything open. */}
        <PressAwayOverlay active={controlsHost.openId !== null} onPress={controlsHost.close} />
        {p2ZoneStyle && <PressAwayOverlay active={controlsHost.openId !== null || p2Host.openId !== null} onPress={p2Host.close} style={p2ZoneStyle} />}

        {!showMetaInSharedBand && <CornerActionButtons onBack={safeBack} onSettings={() => setSettingsOpen(true)} fg={fg} insets={rotatedInsets} />}

        {gameMode === 'twoPlayer' ? (
          // See @tastic/split-screen's DualZoneLayout for the portrait-vs-landscape switch and its
          // own note on why P1's zone stays unrotated while P2's rotates 180° in portrait.
          <DualZoneLayout
            panelLayout={panelLayout}
            panelFadeStyle={panelFadeStyle}
            p1={p1Panel}
            p2={p2Panel}
            shared={sharedControls}
            // Without these, a popover escaping its own zone (e.g. LoadoutSharedControls' own
            // puckPhysics dropdown, which bundles three sections with autoDismiss={false} and can
            // grow tall, down into P1/P2's row below it) paints underneath whichever zone happens
            // to be the later DOM sibling, regardless of which one actually has something open -
            // see DualZoneLayout's own p1Elevated/p2Elevated/sharedElevated doc for the
            // stacking-context reason a zone can't just self-elevate the way
            // PlayerSetupPanel/LoadoutSharedControls already do internally. Same openId checks
            // those two components use for their own internal elevation, just re-run here for the
            // outer zone wrapper neither of them can reach on its own.
            p1Elevated={controlsHost.openId?.startsWith('p1-') ?? false}
            p2Elevated={p2Host.openId !== null}
            sharedElevated={sharedControlsPopoverOpen}
          />
        ) : (
          <View style={styles.stackedZone}>
            {sharedControls}
            <Animated.View style={[styles.playersRow, anyPlayerPickerOpen && styles.playersRowOpen, panelFadeStyle]}>
              {!isPortrait && panelLayout.p1OnRight ? p2Panel : p1Panel}
              {!isPortrait && panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
            <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} style={anyPlayerPickerOpen && styles.readyButtonHidden} />
          </View>
        )}
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} settings={settings} setSettings={setSettings} showHowToPlay />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  p2ZoneLeft: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: '50%'
  },
  p2ZoneRight: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '50%'
  },
  p2ZoneTop: {
    height: '50%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  // Only used by vsCpu's stacked (non-rotated) layout below - two-player's own DualZoneLayout
  // handles p1/p2 spacing itself. vsCpu's human slot and CPU slot (both a lone seat button now -
  // see PlayerSetupPanel) read as one evenly spaced row of triggers this way, rather than two
  // independently-centered blocks throwing off screen-edge symmetry.
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // See anyPlayerPickerOpen above - opacity 0 (not display:'none') so the button keeps its layout
  // space and doesn't shift the row above it when it disappears/reappears. pointerEvents:'none' too
  // - otherwise the sliver an open popover doesn't cover would still be a live, just-invisible tap
  // target underneath it.
  readyButtonHidden: {
    opacity: 0,
    pointerEvents: 'none'
  },
  // Owns the flex-centering layout `container` used to apply directly - now one level deeper,
  // since everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (PressAwayOverlay, back/settings
  // buttons) against correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  stackedZone: {
    alignItems: 'center',
    gap: 28
  }
})
