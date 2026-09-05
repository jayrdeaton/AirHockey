import { SeedColor } from '@rific/auto-paper'
import { ControlSchemePicker, InlineColorPicker, LabeledDropdown, LabeledDropdownOption, MenuOption, PopoverHost, ReadyButton, usePopoverHost } from '@tastic/hud'
import { Profile, ProfilePicker } from '@tastic/profile'
import { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { MONO_FONT } from '@/constants/fonts'
import { ControlScheme } from '@/types'
import { AIDifficulty } from '@/utils/aiOpponent'

export interface PlayerSetupPanelProps {
  // Namespaces this panel's popover id so two panels can safely share one host (see `host` below)
  // without their ids colliding.
  idPrefix: string
  // Shared popover host, when this panel's color picker should be mutually exclusive with another
  // panel's or the shared controls' (vs-CPU: only one human is ever driving both slots, so having
  // both YOU's and CPU's pickers open at once is just clutter, not a useful simultaneous-edit
  // case). Omit to fall back to this panel's own independent host — the two-player case, where two
  // real people editing at once is the point.
  host?: PopoverHost
  label?: string
  color: string
  onColorChange: (hex: string) => void
  swatches: SeedColor[]
  // The other player's current color — stays visible in the swatch grid but disabled, rather than
  // removed from it entirely. Unless allowSwapTaken is set — see InlineColorPicker's own doc.
  takenColor?: string
  allowSwapTaken?: boolean
  isHuman: boolean
  // Web-only (ControlSchemePicker bakes in its own Platform/touch-primary gate — see that
  // component's own doc in @tastic/hud). Mirrors Snake's/Pong's identical trio, renamed for
  // AirHockey's own ControlScheme.
  controlScheme?: ControlScheme
  onControlSchemeChange?: (scheme: ControlScheme) => void
  controlSchemeOptions?: MenuOption<ControlScheme>[]
  // The other seat's current scheme, if any — passed straight through as ControlSchemePicker's own
  // takenValue so it stays in the list (shown disabled) rather than filtered out. Only ever
  // meaningful in two-player mode, the only mode with two human seats potentially sharing one
  // desktop's keyboard/mouse (see loadout.tsx).
  otherControlScheme?: ControlScheme
  ready?: boolean
  onToggleReady?: () => void
  dark: boolean
  // vs-CPU only has one human player, so the loadout screen renders its Ready toggle standalone,
  // centered below both slots, instead of embedded in this panel.
  showReadyButton?: boolean
  profiles?: Profile[]
  selectedProfileId?: string | null
  takenProfileId?: string | null
  // What the name trigger shows before any profile's selected — this seat's own 'P1'/'P2' (see
  // ProfilePicker's own doc for why it's never "Player", the menu's own row for that state).
  // Required whenever profiles is provided, since the trigger always needs some idle text.
  guestLabel?: string
  onProfileSelect?: (profile: Profile | null) => void
  // Navigates to the profile-management screen — only ever provided for P1 (see ProfilePicker's
  // own doc for why: P2's rotated zone can't host a working text keyboard).
  onManageProfiles?: () => void
  // CPU slots only (see isHuman) — the same "trigger sits above the color picker" slot ProfilePicker
  // uses for a human seat's name, just for picking who's actually driving the CPU instead of who
  // you are. Matches LightCycles'/BoxHockey's identical per-seat cpuDifficulty slot.
  cpuDifficulty?: AIDifficulty
  cpuDifficultyOptions?: LabeledDropdownOption<AIDifficulty>[]
  onCpuDifficultyChange?: (value: AIDifficulty) => void
}

// One panel per player slot in the loadout screen: a name label (tap to switch profiles or create
// one, human slots only — falls back to a CPU-difficulty picker for a non-human slot with one
// wired in, or the plain `label` text below when neither applies), a color picker (interactive for
// both human and CPU slots, matching the title screen's own past behavior of letting the CPU's
// color be chosen too) plus a web-only control-scheme picker for human slots, and a Ready toggle
// for human slots only. Owns its own popover host shared by its own pickers unless a `host` is
// passed in to share with another panel or the shared controls instead. Unlike BoxHockey's own
// version (a pull/push aim-style control-scheme row), this one is about WHICH INPUT drives the
// paddle at all — AirHockey's paddle still always follows a mouse/touch drag 1:1 live when that's
// the picked scheme; keyboard is an alternative INPUT SOURCE, not a different feel for the same
// one. aiDifficulty moved here from LoadoutSharedControls' own shared row, matching that cross-app
// convention.
export function PlayerSetupPanel({ idPrefix, host, label, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, controlScheme, onControlSchemeChange, controlSchemeOptions, otherControlScheme, ready, onToggleReady, dark, showReadyButton = true, profiles, selectedProfileId, takenProfileId, guestLabel, onProfileSelect, onManageProfiles, cpuDifficulty, cpuDifficultyOptions, onCpuDifficultyChange }: PlayerSetupPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  const ownPopoverOpen = popover.openId?.startsWith(`${idPrefix}-`) ?? false
  // Narrower than ownPopoverOpen on purpose — only true for a popover actually inside pickerRow
  // itself (color/controls). See pickerRowOpen's own style comment for why pickerRow needs this in
  // addition to panelOpen above.
  const pickerRowPopoverOpen = popover.openId === `${idPrefix}-color` || popover.openId === `${idPrefix}-controls`
  const mutedColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  const showProfilePicker = isHuman && profiles !== undefined && !!onProfileSelect
  const showCpuDifficulty = !isHuman && cpuDifficulty !== undefined && !!cpuDifficultyOptions && !!onCpuDifficultyChange
  // The color button's own tag display (see InlineColorPicker) — read live from the selected
  // profile rather than snapshotted at selection time, since there's no other editing surface for
  // it on this screen at all (see app/profiles.tsx's ProfilesManager, the only place a tag is
  // actually typed).
  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId) ?? null
  // Doesn't pre-fill `color` itself on selection — loadout.tsx's own effect re-derives the seat's
  // live color from `selectedProfileId` (this callback only needs to report the pick) once it sees
  // the id change, which is also what keeps a manual in-session recolor from silently redefining
  // what the profile itself is remembered as; editing the saved color is Manage's own job (see
  // app/profiles.tsx's ProfilesManager).
  const handleProfileSelect = useCallback(
    (profile: Profile | null) => {
      onProfileSelect?.(profile)
    },
    [onProfileSelect]
  )

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {showProfilePicker ? (
        <ProfilePicker idPrefix={idPrefix} host={popover} profiles={profiles!} selectedId={selectedProfileId ?? null} takenId={takenProfileId} color={color} dark={dark} guestLabel={guestLabel ?? 'GUEST'} onSelect={handleProfileSelect} onManage={onManageProfiles} />
      ) : showCpuDifficulty ? (
        <LabeledDropdown id={`${idPrefix}-difficulty`} host={popover} options={cpuDifficultyOptions!} value={cpuDifficulty!} onChange={onCpuDifficultyChange!} color={color} dark={dark} />
      ) : (
        label && (
          <Text variant='labelSmall' style={{ color, fontFamily: MONO_FONT }}>
            {label}
          </Text>
        )
      )}

      <View style={[styles.pickerRow, pickerRowPopoverOpen && styles.pickerRowOpen]}>
        {/* Human slots (which, in two-player mode, is both of them) show the selected profile's
        own tag when it has one, falling back to a face; vs-CPU's CPU slot always falls back to a
        robot (no profile concept there at all) — this is what actually distinguishes "you" from
        "the CPU" now, not a fixed icon. */}
        <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} tag={isHuman ? selectedProfile?.tag : undefined} icon={isHuman ? 'face-man' : 'robot'} />

        {/* Side by side with the color picker. ControlSchemePicker renders nothing of its own
        accord on native or a touch-primary device, so the only gate needed here is isHuman (a CPU
        seat has no scheme to pick at all). */}
        {isHuman && controlScheme && onControlSchemeChange && controlSchemeOptions && <ControlSchemePicker id={`${idPrefix}-controls`} host={popover} value={controlScheme} onChange={onControlSchemeChange} options={controlSchemeOptions} takenValue={otherControlScheme} accentColor={color} mutedColor={mutedColor} dark={dark} />}
      </View>

      {isHuman && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // See SectionedDropdown's anchorOpen comment — this panel is a sibling of the other player's
  // panel (and the shared-controls row) in loadout.tsx, so a popover escaping this panel's bounds
  // needs the panel itself elevated, not just the popover content, to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  },
  // Same gap as `panel`'s own vertical rhythm, reused horizontally — the color and (when shown)
  // control-scheme pickers sit side by side within this row instead of stacked in the panel's own
  // column.
  pickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  // A popover is an absolutely-positioned sibling of its own trigger — so a tall one (the color
  // swatch grid) can extend down far enough to overlap the ReadyButton below, which paints on top
  // of it by default DOM order since it's a later sibling within `panel`. `panel`'s own panelOpen
  // elevation only helps this panel paint above OTHER panels (see its own comment) — it does
  // nothing for stacking *within* this panel, since React Native Web gives each View its own
  // stacking context. This is what actually fixes that: elevate pickerRow itself above its own
  // later sibling whenever one of its popovers is open.
  pickerRowOpen: {
    zIndex: 100
  }
})
