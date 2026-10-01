import { useUpdateErrorToast } from '@rific/toaster'
import type { ViewRotation } from '@tastic/core'
import { BaseSettingsDialog } from '@tastic/hud'
import { useGuide } from '@tastic/hud/guide'

import { release } from '@/constants/release'
import { GameSettings } from '@/types'

export interface SettingsDialogProps {
  visible: boolean
  onDismiss: () => void
  // Live physical-hold rotation (see @tastic/split-screen's getViewRotation) — this is a centered,
  // app-wide modal with no per-player zone to match, so it just rotates its own content in place;
  // defaults to 0 for a call site that doesn't track one.
  rotation?: ViewRotation
  // The persisted "next round" settings (not a round's own locked-in activeRoundSettings) — passed
  // in rather than read internally via useGameSettings() so this stays a pure adapter, matching the
  // cross-app SettingsDialog convention (see LightCycles'/BoxHockey's identical props-based
  // contract). Each of this component's three call sites already has its own settings/setSettings
  // in scope for other reasons, so this is no new plumbing for any of them.
  settings: GameSettings
  setSettings: (update: Partial<GameSettings>) => void
  // Shows the "How to Play" row that replays the intro. Off by default: the in-game (/game) dialog
  // leaves it out, since opening a full-screen guide over a live match (settings there already
  // pauses play) is disruptive. Home and the loadout, where nothing is running, turn it on.
  showHowToPlay?: boolean
}

// Thin adapter over @tastic/hud's shared settings shell — AirHockey's own GameSettings (lock
// orientation, edge guard) is the only thing that varies here; everything else (sound, haptics,
// appearance, update checking) is identical across every app using BaseSettingsDialog and lives
// entirely inside that package now.
export function SettingsDialog({ visible, onDismiss, rotation = 0, settings, setSettings, showHowToPlay = false }: SettingsDialogProps) {
  const onUpdateError = useUpdateErrorToast()
  const { open: openGuide } = useGuide()

  return <BaseSettingsDialog visible={visible} onDismiss={onDismiss} rotation={rotation} version={release.otaVersion} lockOrientation={settings.lockOrientation} onLockOrientationChange={(value) => setSettings({ lockOrientation: value })} deferBottomEdgeGestures={settings.deferBottomEdgeGestures} onDeferBottomEdgeGestures={(value) => setSettings({ deferBottomEdgeGestures: value })} onUpdateError={onUpdateError} onShowHowToPlay={showHowToPlay ? openGuide : undefined} />
}
