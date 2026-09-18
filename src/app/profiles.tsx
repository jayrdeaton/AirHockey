import { defaultColors } from '@rific/auto-paper'
import { ProfilesScreen } from '@tastic/profile'

import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { safeBack } from '@/utils/navigation'

// A real routed screen — reachable only from P1's dropdown (see ProfilePicker's own doc for why
// P2 can't host this: its zone is 180°-rotated in face-to-face mode, and the OS keyboard doesn't
// rotate with it). Reads useProfiles() directly rather than taking it as props from loadout.tsx —
// there's nothing left for that screen to thread through once this is its own destination instead
// of conditionally-rendered state living on the loadout itself. Mirrors Pong's identically-shaped
// app/profiles.tsx — createProfile here takes just {name, color, tag}, since AirHockey's Profile is
// the package's own base type, unmodified. The container/back-button/theme-derived bg-fg/commit-
// before-navigate composition all now live inside @tastic/profile's own ProfilesScreen.
export default function Profiles() {
  const { profiles, createProfile, updateProfile, deleteProfile } = useProfiles()
  // Only for wiring onDelete below — nothing else on this screen touches stats directly.
  const { removeProfileStats } = useGameStats()

  return (
    <ProfilesScreen
      profiles={profiles}
      defaultColor={defaultColors[0].value}
      onCreate={(patch) => createProfile(patch)}
      onSave={(id, patch) => updateProfile(id, patch)}
      onDelete={(id) => {
        deleteProfile(id)
        removeProfileStats(id)
      }}
      onBack={safeBack}
    />
  )
}
