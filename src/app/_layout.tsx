import { useAutoPaperTheme } from '@rific/auto-paper'
import { Toaster, ToastProvider } from '@rific/toaster'
import { OrientationProvider, RotationAwareStatusBar, SettingsAndProfilesGate, useThemedRootBackground } from '@tastic/core'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Fonts } from '@/components/Fonts'
import { Providers } from '@/components/Providers'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider, useGameSettings } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { SplashGate } from '@/utils/splashGate'

// Sits below Theme (so it can read the live theme) — same role ConnectedRotationAwareStatusBar
// below plays for settings.lockOrientation. Kept as its own component (rather than inlining Stack
// directly in RootLayout) purely so this app's own corner-flash fix has one place to live. The
// corner-flash fix itself (the module-level SystemUI call + the live-theme-tracking effect) now
// lives in @tastic/core's useThemedRootBackground — see its own doc for why react-native-screens'
// push/pop transition needs both that and contentStyle below.
function AppStack() {
  const { dark } = useAutoPaperTheme()
  return <Stack screenOptions={useThemedRootBackground(dark, false)} />
}

// A sibling of the Stack, not a wrapper around it — same reasoning as @tastic/core's own
// RotationAwareStatusBar doc (calling useOrientationState() here rather than in RootLayout itself
// keeps every live tilt update from re-rendering the whole app tree on every commit). This app's own
// "Lock Orientation" setting lives in GameSettingsProvider's context though, which RootLayout's own
// body sits above (it renders GameSettingsProvider as an ancestor, so it isn't itself a descendant of
// it) — so this thin wrapper reads settings via useGameSettings() and threads it through as `locked`,
// same value index.tsx's/loadout.tsx's own useOrientationState calls use, rather than lifting that
// read up into RootLayout where it isn't reachable.
function ConnectedRotationAwareStatusBar() {
  const { settings } = useGameSettings()
  return <RotationAwareStatusBar locked={settings.lockOrientation} />
}

interface ReadyGateProps {
  children: ReactNode
}

// GameSettingsProvider's own `settings` state is a plain useState with DEFAULT_SETTINGS baked in,
// only patched once an AsyncStorage read resolves — every screen below it reads `settings` straight
// off context, so a screen mounting before that patch lands would read (and could even briefly
// persist) the wrong values. Declared as a descendant of BOTH GameSettingsProvider and
// ProfilesProvider below (rather than gating either provider's own mount from _layout.tsx) so both
// providers always mount immediately and start their loads in parallel — only what's nested INSIDE
// this gate waits for `loaded`. GameStatsProvider is deliberately OUTSIDE the gate too (an ancestor
// of it, not a descendant — see RootLayout below), for the exact same reason: its own AsyncStorage
// load should start immediately alongside the other two, not wait on settings/profiles to resolve
// first. useGameSettings()/useProfiles() are app-local hooks @tastic/core's shared
// SettingsAndProfilesGate can't call itself, so this thin wrapper supplies their `loaded` fields as
// plain props, along with this app's own bound Gate (settings outer, profiles inner — see
// splashGate.ts's 'settings'/'profiles' gates).
function GatedApp({ children }: ReadyGateProps) {
  const { loaded: settingsLoaded } = useGameSettings()
  const { loaded: profilesLoaded } = useProfiles()
  return (
    <SettingsAndProfilesGate Gate={SplashGate} settingsLoaded={settingsLoaded} profilesLoaded={profilesLoaded}>
      {children}
    </SettingsAndProfilesGate>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Fonts>
          <Providers>
            <Theme>
              <GameSettingsProvider>
                <ProfilesProvider>
                  {/* All three providers above/here always mount unconditionally, immediately, as
                  parallel ancestors of the gate below — so GameSettingsProvider's, ProfilesProvider's,
                  and GameStatsProvider's own AsyncStorage loads all start in parallel, none waiting on
                  either of the others' `loaded` flag first. Only what's nested INSIDE the gate below
                  (the navigator and everything it owns) waits for settings/profiles — see GatedApp's
                  own doc. Matches BoxHockey's/Pong's identical shape. */}
                  <GameStatsProvider>
                    <GatedApp>
                      {/* Mounted once, here, rather than per-screen — see OrientationProvider's
                      own doc for why: a single app-lifetime sensor subscription is what makes the
                      committed orientation survive screen navigation, instead of each screen's own hook
                      instance restarting from a default guess on every mount. */}
                      {/* deviceMotion is the app's own real expo-sensors import, injected rather than
                      imported by @tastic/core itself — see that package's own doc for why. */}
                      <OrientationProvider deviceMotion={DeviceMotion}>
                        <ToastProvider haptics={Haptics} paper={RNPaper}>
                          <AppStack />
                          <ConnectedRotationAwareStatusBar />
                          {/* historyButton/clearButton off — this app has no history modal use case
                          for them to open, and a stray control row above the toast stack for a
                          feature that goes nowhere is worse than just not offering it. limit is
                          already the package's own default (3); pinned explicitly so it stays 3
                          regardless of what that default does in a future toaster version. */}
                          <Toaster historyButton={null} clearButton={null} limit={3} />
                          <UpdateDialog />
                        </ToastProvider>
                      </OrientationProvider>
                    </GatedApp>
                  </GameStatsProvider>
                </ProfilesProvider>
              </GameSettingsProvider>
            </Theme>
          </Providers>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
