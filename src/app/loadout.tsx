import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { CornerActionButtons, MenuOption, PressAwayOverlay, ReadyButton, SharedActionBand, usePopoverHost } from '@tastic/hud'
import { Profile } from '@tastic/profile'
import { DualZoneLayout, FakeLandscapeView, getViewRotation, needsSharedNeutralZone, rotateInsets, useAccelerometerOrientation, useDualZoneLayout } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LOADOUT_SHARED_CONTROLS_IDS, LoadoutSharedControls } from '@/components/LoadoutSharedControls'
import { PlayerSetupPanel } from '@/components/PlayerSetupPanel'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR, loadCpuColor, loadGuestColors, saveCpuColor, saveGuestColors } from '@/components/Theme'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useProfiles } from '@/hooks/useProfiles'
import { ControlScheme, FrictionLevel, PaddleSizeLevel, Player, PuckSizeLevel } from '@/types'
import { AIDifficulty } from '@/utils/aiOpponent'
import { humanPlayersFor, parseGameMode } from '@/utils/gameMode'
import { DEFAULT_SETTINGS } from '@/utils/gameSettingsValidation'
import { safeBack } from '@/utils/navigation'

// BoxHockey's own constants/game.ts owns LOADOUT_PANEL_SWAP_FADE_MS, but AirHockey's version of
// that file is owned by the physics/board work happening elsewhere in this build — kept local here
// instead of adding to it, same 180ms BoxHockey itself uses for this exact fade.
const PANEL_SWAP_FADE_MS = 180

const FRICTION_OPTIONS: MenuOption<FrictionLevel>[] = [
  { value: 'high', label: 'Slow', description: 'Puck stops quickly', icon: 'speedometer-slow' },
  { value: 'medium', label: 'Medium', description: 'Standard glide', icon: 'speedometer-medium' },
  { value: 'low', label: 'Fast', description: 'Puck glides farther', icon: 'speedometer' }
]

// Rewritten from BoxHockey's own puck-size descriptions, which referenced divider gaps that don't
// exist here — AirHockey's puck size instead scales the goal mouth itself (see GOAL_WIDTH_RATIO in
// constants/game.ts), so it's a forgiveness/difficulty knob on scoring rather than a squeeze-through
// one.
const PUCK_SIZE_OPTIONS: MenuOption<PuckSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Narrower goals, harder to score', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Wider goals, easier to score', icon: 'circle-outline' }
]

// New relative to BoxHockey — the paddle now physically collides with the puck (see
// applyPaddleCollision in utils/physics.ts), so its size is a real defense/precision knob, not just
// cosmetic. Same size-tier option shape as PUCK_SIZE_OPTIONS above.
const PADDLE_SIZE_OPTIONS: MenuOption<PaddleSizeLevel>[] = [
  { value: 'small', label: 'Small', description: 'Smaller mallet, more precision', icon: 'circle-small' },
  { value: 'medium', label: 'Medium', description: 'Standard size', icon: 'circle-medium' },
  { value: 'large', label: 'Large', description: 'Bigger mallet, easier defense', icon: 'circle-outline' }
]

const SCORE_TO_WIN_OPTIONS: MenuOption<number>[] = [3, 5, 7, 10].map((value) => ({ value, label: String(value) }))

// aiOpponent.ts (already ported, untouched) has no AI_DIFFICULTY_LABELS export of its own — unlike
// BoxHockey's version, it only exports the AIDifficulty type and the pure tuning function — so the
// labels live here instead, same three tiers.
const AI_DIFFICULTY_OPTIONS: MenuOption<AIDifficulty>[] = [
  { value: 'easy', label: 'Easy', icon: 'emoticon-happy-outline' },
  { value: 'medium', label: 'Medium', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'Hard', icon: 'emoticon-devil-outline' }
]

// Left icon-less, mirroring Snake's/Pong's own CONTROL_SCHEME_OPTIONS exactly — there's no
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
  // Read only from this screen's own route param, never from useGameSettings().settings.gameMode
  // — the settings hook's AsyncStorage read is async, and racing it here could momentarily show
  // the wrong number of player panels.
  const params = useLocalSearchParams<{ mode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.mode), [params.mode])
  const humanPlayers = useMemo(() => humanPlayersFor(gameMode), [gameMode])

  const { settings, setSettings, commitRoundSettings } = useGameSettings()
  const { profiles, lastSelected, selectProfile } = useProfiles()
  // orientationMode just follows the device's own physical tilt (see useAccelerometerOrientation),
  // CPU games included — how you're holding the phone right now decides the panel arrangement,
  // not a stored per-round choice. This is what lets two players sit shoulder-to-shoulder and pick
  // a color at the same time once the phone is turned sideways, instead of a portrait-narrow
  // column — and for vs-CPU, it's simply whichever way the solo player is holding it. Lock
  // Orientation (see SettingsDialog) is the opt-in for pinning it.
  const { orientationMode, p1OnRight, upsideDown, resolved: p1OnRightResolved } = useAccelerometerOrientation(settings.lockOrientation)

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight/upsideDown above — see useDualZoneLayout's own
  // comment. Also drives the solo (vs-CPU) branch's own row below — that one doesn't rotate anyone
  // 180°, but still reorders/fades across a portrait<->landscape change the same way.
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(orientationMode, p1OnRight, p1OnRightResolved, upsideDown, PANEL_SWAP_FADE_MS)

  const [settingsOpen, setSettingsOpen] = useState(false)
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) — rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated, using the same committed
  // rotation FakeLandscapeView itself renders with, so `top`/`left`/`right` below always mean the
  // screen's real, visual edges regardless of how the phone is being held.
  const rotation = getViewRotation(panelLayout.orientationMode, panelLayout.p1OnRight, panelLayout.upsideDown)
  const rotatedInsets = rotateInsets(useSafeAreaInsets(), rotation)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // CPU always plays P2 (see useAIOpponent's own comment) — needed above the profile/guest/CPU
  // color logic below, not just the panel wiring further down.
  const p2IsHuman = humanPlayers.includes(2)
  const p1Profile = profiles.find((p) => p.id === lastSelected[1]) ?? null
  const p2Profile = p2IsHuman ? (profiles.find((p) => p.id === lastSelected[2]) ?? null) : null

  // This screen's own memory for a human seat with no profile selected, and (separately) for
  // vs-CPU's own CPU seat — see Theme.tsx's loadGuestColors/loadCpuColor for why these are two
  // distinct AsyncStorage slots rather than one. Both start `null` (rather than seeded from
  // DEFAULT_P1_COLOR/DEFAULT_P2_COLOR) so the reconciliation effect below never briefly paints a
  // default over a real stored value it just hasn't finished reading yet.
  const [guestColors, setGuestColors] = useState<{ p1: string; p2: string } | null>(null)
  const [cpuColor, setCpuColor] = useState<string | undefined>(undefined)
  useEffect(() => {
    loadGuestColors().then(setGuestColors)
    loadCpuColor().then(setCpuColor)
  }, [])

  // Keeps the live (whole-app) theme in sync with each seat's own color SOURCE, re-deriving it any
  // time either seat's identity changes: mount, a fresh profile pick, clearing back to guest,
  // switching game modes, or (vs-CPU) once the CPU's own remembered color finishes loading. A
  // profile-selected seat always wins with that profile's CURRENT .color; otherwise it falls back
  // to this seat's own guest/CPU slot. One combined effect (not one per seat) since two independent
  // setThemeColor calls would each overwrite the other's just-applied color with a stale snapshot
  // of it — `color` is a whole {primary, secondary, tertiary} triad, not a per-seat patch.
  // Deliberately keyed on the selected ids/mode, not on `profiles` or the resolved profile objects
  // themselves — `profiles` gets a fresh reference on every foreground refresh in useProfiles.tsx,
  // and a profile's own record changing elsewhere while the selected id stays the same is out of
  // scope here (this is a live-edit-while-mounted-elsewhere edge case). Manual recolors/clash-swaps
  // (handleP1ColorChange/handleP2ColorChange below) never touch this effect's own deps, so they're
  // free to repaint the live theme without this effect fighting back.
  useEffect(() => {
    const nextP1 = p1Profile ? p1Profile.color : guestColors?.p1
    const nextP2 = !p2IsHuman ? cpuColor : p2Profile ? p2Profile.color : guestColors?.p2
    if (nextP1 === undefined || nextP2 === undefined) return
    setThemeColor({ color: { primary: nextP1, secondary: nextP2, tertiary: getThirdColor(nextP1, nextP2) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected[1], lastSelected[2], p2IsHuman, guestColors, cpuColor])

  const persistGuestColors = useCallback((patch: Partial<{ p1: string; p2: string }>) => {
    setGuestColors((prev) => {
      const next = { p1: prev?.p1 ?? DEFAULT_P1_COLOR, p2: prev?.p2 ?? DEFAULT_P2_COLOR, ...patch }
      saveGuestColors(next)
      return next
    })
  }, [])
  const persistCpuColor = useCallback((hex: string) => {
    setCpuColor(hex)
    saveCpuColor(hex)
  }, [])

  // Picking the other slot's exact current color swaps the two instead of no-op'ing — only
  // reachable at all when that slot's own picker allowed it (allowSwapTaken: vs-CPU only, where
  // the "other" color there is only ever the CPU's, not a second real person's choice). Each side's
  // resulting color persists to whichever slot that seat currently owns: nowhere at all for a
  // profile-selected seat (its own saved .color stays the source of truth — see the reconciliation
  // effect above), this seat's own guest slot for a human with no profile selected, or the CPU slot
  // for vs-CPU's own seat — independently of the other seat, so a clash-swap between e.g. a CPU
  // seat and a guest seat updates each one's own remembered color.
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const nextP2 = hex.toLowerCase() === p2Color.toLowerCase() ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
      if (!p1Profile) persistGuestColors({ p1: hex })
      if (nextP2 !== p2Color) {
        if (!p2IsHuman) persistCpuColor(nextP2)
        else if (!p2Profile) persistGuestColors({ p2: nextP2 })
      }
    },
    [setThemeColor, p1Color, p2Color, p1Profile, p2Profile, p2IsHuman, persistGuestColors, persistCpuColor]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const nextP1 = hex.toLowerCase() === p1Color.toLowerCase() ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
      if (!p2IsHuman) persistCpuColor(hex)
      else if (!p2Profile) persistGuestColors({ p2: hex })
      if (nextP1 !== p1Color && !p1Profile) persistGuestColors({ p1: nextP1 })
    },
    [setThemeColor, p1Color, p2Color, p1Profile, p2Profile, p2IsHuman, persistGuestColors, persistCpuColor]
  )

  // Fires on every profile pick, including reselecting whichever profile is already selected for
  // this seat — that's what actually snaps a seat back to its profile's own saved color if a
  // manual recolor had transiently drifted it, matching what leaving and returning to this screen
  // does via the reconciliation effect above (which this otherwise overlaps with harmlessly: same
  // color, applied again). PlayerSetupPanel itself no longer does this pre-fill — it can't tell a
  // fresh pick from a reselect apart from `selectedProfileId` alone, and by the time it would call
  // back up here the seat's own profile/guest/CPU state (p1Profile et al.) is still this render's
  // stale snapshot, not the one selectProfile is about to commit.
  const handleP1ProfileSelect = useCallback(
    (profile: Profile | null) => {
      selectProfile(1, profile?.id ?? null)
      if (profile) setThemeColor({ color: { primary: profile.color, secondary: p2Color, tertiary: getThirdColor(profile.color, p2Color) } })
    },
    [selectProfile, setThemeColor, p2Color]
  )
  const handleP2ProfileSelect = useCallback(
    (profile: Profile | null) => {
      selectProfile(2, profile?.id ?? null)
      if (profile) setThemeColor({ color: { primary: p1Color, secondary: profile.color, tertiary: getThirdColor(p1Color, profile.color) } })
    },
    [selectProfile, setThemeColor, p1Color]
  )

  // Covers exactly the fields LoadoutSharedControls itself exposes — puck/paddle physics, score to
  // win, and (vs-CPU only) AI difficulty, since that picker also lives in this shared row rather
  // than a per-player panel the way LightCycles' cpuDifficulty does. Per-player stuff (colors) and
  // app-wide prefs (lock orientation) live outside this row and aren't "match settings" in the
  // sense a player means when they ask to shuffle or reset the current round. Matches BoxHockey's
  // identically-shaped handlers.
  const handleRandomizeMatchSettings = useCallback(() => {
    setSettings({
      friction: pickRandom(FRICTION_OPTIONS),
      puckSize: pickRandom(PUCK_SIZE_OPTIONS),
      paddleSize: pickRandom(PADDLE_SIZE_OPTIONS),
      scoreToWin: pickRandom(SCORE_TO_WIN_OPTIONS),
      ...(gameMode === 'vsCpu' ? { aiDifficulty: pickRandom(AI_DIFFICULTY_OPTIONS) } : {})
    })
  }, [setSettings, gameMode])

  const handleResetMatchSettings = useCallback(() => {
    setSettings({
      friction: DEFAULT_SETTINGS.friction,
      puckSize: DEFAULT_SETTINGS.puckSize,
      paddleSize: DEFAULT_SETTINGS.paddleSize,
      scoreToWin: DEFAULT_SETTINGS.scoreToWin,
      ...(gameMode === 'vsCpu' ? { aiDifficulty: DEFAULT_SETTINGS.aiDifficulty } : {})
    })
  }, [setSettings, gameMode])

  const [ready, setReady] = useState<Record<Player, boolean>>({ 1: false, 2: false })

  // Every time this screen (re)gains focus — first arrival from the title screen, or coming back
  // here via the post-game "Loadout" button — Ready starts false again. Without this, popping back
  // to an already-mounted loadout whose players both left it Ready would immediately re-trigger the
  // all-ready effect below and bounce straight back into /game.
  useFocusEffect(
    useCallback(() => {
      setReady({ 1: false, 2: false })
    }, [])
  )

  useEffect(() => {
    if (!humanPlayers.every((p) => ready[p])) return
    // `gameMode` here, not `settings.gameMode` — same race the comment above guards against: this
    // screen's own route param is the trustworthy value, not the settings hook's own (possibly
    // still-loading) copy.
    commitRoundSettings({ ...settings, gameMode })
    router.push('/game')
  }, [ready, humanPlayers, settings, gameMode, commitRoundSettings])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const isPortrait = panelLayout.orientationMode === 'faceToFace'
  // See @tastic/split-screen's needsSharedNeutralZone for the full reasoning — extracted there
  // once this exact boolean turned up independently hand-duplicated across LightCycles/BoxHockey/
  // Snake too.
  const showMetaInSharedBand = needsSharedNeutralZone(panelLayout.orientationMode, humanPlayers.length)

  // Where P2's own press-away zone lives on screen — matches panelLayout (the already-committed,
  // currently-painted layout), not the live orientationMode/p1OnRight, since it needs to agree with
  // whichever arrangement is actually on screen right now, mid-fade included. Portrait always
  // renders P2's panel in the top half (see DualZoneLayout below); landscape puts it on whichever
  // side panelLayout.p1OnRight says isn't P1's. Only meaningful in two-player mode — vsCpu's P2/CPU
  // slot shares controlsHost instead (see p2Host below), so it never needs a zone of its own.
  const p2ZoneStyle = gameMode === 'twoPlayer' ? (isPortrait ? styles.p2ZoneTop : panelLayout.p1OnRight ? styles.p2ZoneLeft : styles.p2ZoneRight) : null

  // Vs-CPU only has one human slot, so its Ready toggle renders standalone below both panels
  // instead of embedded in this panel.
  const showReadyButton = gameMode === 'twoPlayer'
  // P1's own panel and the shared controls row always share one host — mutually exclusive
  // regardless of game mode, since both sit in the same near/bottom zone. Vs-CPU additionally
  // folds P2/CPU's panel into this same host: only one human is ever driving both slots there, so
  // having both YOU's and CPU's popovers open at once is just clutter. Two-player mode keeps P2 on
  // its own independent host, since two real people editing at once is the whole point there —
  // loadout.tsx (rather than PlayerSetupPanel's own internal fallback) owns it explicitly so the
  // press-away zones below can close it without a P1-side tap ever reaching into P2's own popover,
  // or vice versa.
  const controlsHost = usePopoverHost()
  const p2PanelHost = usePopoverHost()
  const p2Host = gameMode === 'vsCpu' ? controlsHost : p2PanelHost
  // Vs-CPU's own standalone Ready button (below, not per-panel — see showReadyButton) is centered
  // under the whole row, not under either player's own trigger, so it doesn't share a center with
  // an open popover the way a two-player panel's *embedded* Ready button does. A side player's
  // popover is centered on that player's own (off-center) trigger instead, so it can't fully cover
  // the wider gap between its edge and the standalone button's — leaving a sliver of the button's
  // own border peeking out from beside/behind the popover. Faded out instead while any player's
  // popover is open, rather than trying to reconcile the two different centers.
  const anyPlayerPickerOpen = !!(controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-'))

  const sharedControlsRow = (
    <LoadoutSharedControls
      host={controlsHost}
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
      // instead — otherwise both would render at once.
      onRandomize={showMetaInSharedBand ? undefined : handleRandomizeMatchSettings}
      onReset={showMetaInSharedBand ? undefined : handleResetMatchSettings}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  // Only wrapped for showMetaInSharedBand (see its own comment above) — everywhere else back/
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

  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman controlScheme={settings.controlScheme[1]} onControlSchemeChange={(scheme) => setSettings({ controlScheme: { ...settings.controlScheme, 1: scheme } })} controlSchemeOptions={CONTROL_SCHEME_OPTIONS} otherControlScheme={p2IsHuman ? settings.controlScheme[2] : undefined} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} profiles={profiles} selectedProfileId={lastSelected[1]} takenProfileId={lastSelected[2]} guestLabel='P1' onProfileSelect={handleP1ProfileSelect} onManageProfiles={() => router.push('/profiles')} />
  const p2Panel = (
    <PlayerSetupPanel
      idPrefix='p2'
      host={p2Host}
      color={p2Color}
      onColorChange={handleP2ColorChange}
      swatches={defaultColors}
      takenColor={p1Color}
      allowSwapTaken={gameMode === 'vsCpu'}
      isHuman={p2IsHuman}
      controlScheme={p2IsHuman ? settings.controlScheme[2] : undefined}
      onControlSchemeChange={p2IsHuman ? (scheme) => setSettings({ controlScheme: { ...settings.controlScheme, 2: scheme } }) : undefined}
      controlSchemeOptions={p2IsHuman ? CONTROL_SCHEME_OPTIONS : undefined}
      otherControlScheme={p2IsHuman ? settings.controlScheme[1] : undefined}
      ready={p2IsHuman ? ready[2] : undefined}
      onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined}
      dark={dark}
      showReadyButton={showReadyButton}
      profiles={p2IsHuman ? profiles : undefined}
      selectedProfileId={lastSelected[2]}
      takenProfileId={lastSelected[1]}
      guestLabel='P2'
      onProfileSelect={p2IsHuman ? handleP2ProfileSelect : undefined}
      cpuDifficulty={p2IsHuman ? undefined : settings.aiDifficulty}
      cpuDifficultyOptions={p2IsHuman ? undefined : AI_DIFFICULTY_OPTIONS}
      onCpuDifficultyChange={p2IsHuman ? undefined : (value: AIDifficulty) => setSettings({ aiDifficulty: value })}
    />
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held —
      see @tastic/split-screen's FakeLandscapeView for why this is needed at all now that the app
      is portrait-locked at the OS level (no more real OS rotation to rely on). Driven by
      panelLayout (the same committed, already-fade-masked state DualZoneLayout itself renders
      from), not the live orientationMode/p1OnRight/upsideDown above, so the visual rotation change
      and the panel swap/reorder always land in the same fade-covered moment instead of one
      snapping ahead of the other. SettingsDialog is deliberately left outside this wrapper — it
      renders as a centered modal overlay, unaffected by (and not needing) this transform. */}
      <FakeLandscapeView orientationMode={panelLayout.orientationMode} p1OnRight={panelLayout.p1OnRight} upsideDown={panelLayout.upsideDown} style={styles.rotatable}>
        {/* Press-away overlays for the loadout screen's own popovers (color pickers, shared-setting
        dropdowns) — see PressAwayOverlay's own comment for the paint-order trick that keeps real
        controls directly tappable. P1's covers the whole screen (their own panel plus every shared
        setting reads as "theirs" — see LoadoutSharedControls), while P2's is scoped to just their
        own half (p2ZoneStyle) and, being a later sibling, takes priority over P1's within that rect.

        P2's overlay has to mount whenever *either* host has something open, not just p2Host — P1's
        popover being open is exactly when P1's full-screen overlay is sitting underneath P2's zone
        too, and if P2's own overlay were absent then (p2Host closed), a tap anywhere on P2's side
        would fall straight through to P1's and close P1's dialog. Mounting it any time controlsHost
        is open too — even though its own onPress (p2Host.close) is then a no-op — makes it "shield"
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
            // to be the later DOM sibling, regardless of which one actually has something open —
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

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} settings={settings} setSettings={setSettings} />
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
  // Only used by vsCpu's stacked (non-rotated) layout below — two-player's own DualZoneLayout
  // handles p1/p2 spacing itself. vsCpu's human slot and CPU slot (both a lone color circle now —
  // see PlayerSetupPanel) read as one evenly spaced row of triggers this way, rather than two
  // independently-centered blocks throwing off screen-edge symmetry.
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // See anyPlayerPickerOpen above — opacity 0 (not display:'none') so the button keeps its layout
  // space and doesn't shift the row above it when it disappears/reappears. pointerEvents:'none' too
  // — otherwise the sliver an open popover doesn't cover would still be a live, just-invisible tap
  // target underneath it.
  readyButtonHidden: {
    opacity: 0,
    pointerEvents: 'none'
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper,
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
