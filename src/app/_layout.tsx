import { Toaster, ToastProvider } from '@rific/toaster'
import { AccelerometerOrientationProvider, getViewRotation, useAccelerometerOrientation } from '@tastic/split-screen'
import * as Haptics from 'expo-haptics'
import { Stack } from 'expo-router'
import { DeviceMotion } from 'expo-sensors'
import { StatusBar } from 'expo-status-bar'
import { ReactNode } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import * as RNPaper from 'react-native-paper'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { Feedback } from '@/components/Feedback'
import { Fonts } from '@/components/Fonts'
import { Theme } from '@/components/Theme'
import { UpdateDialog } from '@/components/UpdateDialog'
import { GameSettingsProvider, useGameSettings } from '@/hooks/useGameSettings'
import { GameStatsProvider } from '@/hooks/useGameStats'
import { ProfilesProvider, useProfiles } from '@/hooks/useProfiles'
import { SplashGate } from '@/utils/splashGate'

// A sibling of the Stack, not a wrapper around it — calling useAccelerometerOrientation() here
// rather than in RootLayout itself keeps every live tilt update from re-rendering the whole app
// tree on every commit. See LightCycles' identical RotationAwareStatusBar for the full reasoning:
// the real OS status bar can't rotate along with our own virtual content rotation (see
// @tastic/split-screen's getViewRotation/FakeLandscapeView) — it's always pinned to the device's
// own physical top edge — so once index.tsx/loadout.tsx rotate anything away from right-side-up
// portrait, the status bar just reads as visually wrong instead of blending in. Hidden whenever the
// live rotation isn't 0° sidesteps that. /game's own unconditional `<StatusBar hidden />` still
// layers on top of this one while mounted.
function RotationAwareStatusBar() {
  const { orientationMode, p1OnRight, upsideDown } = useAccelerometerOrientation()
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  return <StatusBar hidden={rotation !== 0} />
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
// this gate (and ProfilesReadyGate below it) waits for `loaded`. See splashGate.ts's 'settings' gate.
function SettingsReadyGate({ children }: ReadyGateProps) {
  const { loaded } = useGameSettings()
  return (
    <SplashGate gate='settings' ready={loaded}>
      {children}
    </SplashGate>
  )
}

// Same reasoning as SettingsReadyGate above, for ProfilesProvider's own `loaded` — which itself only
// flips true once BOTH the local AsyncStorage read and, when the shared App Group store is
// available, the shared-store read have resolved (see useProfiles.tsx). See splashGate.ts's
// 'profiles' gate.
function ProfilesReadyGate({ children }: ReadyGateProps) {
  const { loaded } = useProfiles()
  return (
    <SplashGate gate='profiles' ready={loaded}>
      {children}
    </SplashGate>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Fonts>
          <Feedback>
            <Theme>
              <GameSettingsProvider>
                <ProfilesProvider>
                  {/* Both providers above always mount unconditionally (so both start loading in
                  parallel); everything below these two gates waits for both `loaded` flags — see
                  SettingsReadyGate/ProfilesReadyGate's own docs. */}
                  <SettingsReadyGate>
                    <ProfilesReadyGate>
                      {/* Mounted once, here, rather than per-screen — see AccelerometerOrientationProvider's
                      own doc for why: a single app-lifetime sensor subscription is what makes the
                      committed orientation survive screen navigation, instead of each screen's own hook
                      instance restarting from a default guess on every mount. */}
                      <GameStatsProvider>
                        {/* deviceMotion is the app's own real expo-sensors import, injected rather than
                        imported by @tastic/core itself — see that package's own doc for why. */}
                        <AccelerometerOrientationProvider deviceMotion={DeviceMotion}>
                          <ToastProvider haptics={Haptics} paper={RNPaper}>
                            <Stack screenOptions={{ headerShown: false, gestureEnabled: false }} />
                            <RotationAwareStatusBar />
                            <Toaster />
                            <UpdateDialog />
                          </ToastProvider>
                        </AccelerometerOrientationProvider>
                      </GameStatsProvider>
                    </ProfilesReadyGate>
                  </SettingsReadyGate>
                </ProfilesProvider>
              </GameSettingsProvider>
            </Theme>
          </Feedback>
        </Fonts>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 }
})
