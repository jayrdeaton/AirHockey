import { useAutoPaperTheme } from '@rific/auto-paper'
import { Button, IconButton } from '@rific/feedback-press'
import { FakeLandscapeView, getViewRotation, rotateInsets, useOrientationState } from '@tastic/core'
import { useAutoShowGuide } from '@tastic/hud/guide'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HeroTitle } from '@/components/HeroTitle'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useSettings } from '@/hooks/useSettings'
import { GameMode } from '@/types'

export default function HomeScreen() {
  const { settings, setSettings } = useSettings()
  // No P1/P2 concept on this screen at all, but the rotation angle itself still needs the real
  // p1OnRight reading (which direction the device was actually turned) to pick the correct sign —
  // see @tastic/core's FakeLandscapeView/getViewRotation. Lock Orientation needs nothing here: it
  // freezes the shared reading itself (see OrientationBridge in _layout.tsx).
  const { orientationMode, p1OnRight, upsideDown } = useOrientationState()

  const [settingsOpen, setSettingsOpen] = useState(false)
  // First launch only (and once per session): opens the how-to-play cards over this screen. Called
  // here and nowhere else so it can never fire over a live match or a two-seat loadout. Home is the
  // one screen with a single reader, before any seating. See GuideHost / @tastic/hud/guide.
  useAutoShowGuide()
  const { colors, dark } = useAutoPaperTheme()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) — rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated.
  const rotatedInsets = rotateInsets(useSafeAreaInsets(), rotation)

  // High-contrast retro look: literal black/white, flipped by appearance, rather than auto-paper's
  // own (slightly tinted) background role.
  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'

  const chooseMode = useCallback(
    (gameMode: GameMode) => {
      setSettings({ gameMode })
      router.push({ pathname: '/loadout', params: { mode: gameMode } })
    },
    [setSettings]
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held:
      see @tastic/core's FakeLandscapeView. SettingsDialog stays outside it: it renders through a
      Portal over the whole screen, and BaseSettingsDialog lays itself out in its own frame turned
      by the `rotation` passed below (see @tastic/hud's RotatedFrame). */}
      <FakeLandscapeView orientationMode={orientationMode} p1OnRight={p1OnRight} upsideDown={upsideDown} style={styles.rotatable}>
        {/* Same top-left slot every @tastic title screen uses for this — see LightCycles' own
        identical trophy IconButton. */}
        <IconButton icon='trophy' iconColor={fg} size={24} style={[styles.topLeft, { top: 8 + rotatedInsets.top, left: 8 + rotatedInsets.left }]} onPress={() => router.push('/achievements')} accessibilityLabel='Stats & Achievements' />
        <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + rotatedInsets.top, right: 8 + rotatedInsets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

        <HeroTitle color={fg} p1Color={colors.primary} p2Color={colors.secondary} />

        <View style={styles.actions}>
          <Button mode='contained' icon='account' onPress={() => chooseMode('vsCpu')} style={styles.actionButton}>
            One Player
          </Button>
          <Button mode='contained' icon='account-multiple' onPress={() => chooseMode('twoPlayer')} style={styles.actionButton} buttonColor={colors.secondary} textColor={colors.onSecondary}>
            Two Player
          </Button>
        </View>
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} rotation={rotation} settings={settings} setSettings={setSettings} showHowToPlay />
    </View>
  )
}

const styles = StyleSheet.create({
  actionButton: {
    minWidth: 180
  },
  actions: {
    alignItems: 'center',
    gap: 16
  },
  container: {
    flex: 1
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper,
  // since everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (the settings button) against
  // correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 48,
    justifyContent: 'center'
  },
  topLeft: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
