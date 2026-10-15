import { Provider as AutoPaperProvider, themeActions, type ThemeSettings, useThemeBridgeProps } from '@rific/auto-paper'
import * as ExpoBlur from 'expo-blur'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback } from 'react'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { type RootState } from '@/redux/store'
import { markSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

interface Props {
  children: ReactNode
}

// Theme state (appearance, blur, color triad, harmony) lives entirely in Redux now - redux/store.ts's
// own `theme` slice (@rific/auto-paper's createThemeReducer, seeded with DEFAULT_P1_COLOR/
// DEFAULT_P2_COLOR - see constants/game.ts) - and persists automatically via redux-persist same as
// every other slice, since it isn't blacklisted in persistConfig. This replaces the old split of
// "appearance persisted to its own AsyncStorage key here" + "guest/CPU colors persisted to two more
// AsyncStorage keys, loaded async and merged in as the initial color" with one unified, already-
// rehydrated-by-mount-time Redux value - see redux/seatColorsSlice.ts for the separate "what to
// remember as the guest's/CPU's color next time" memory /loadout now reads/writes instead (that one
// is NOT the live theme snapshot this component owns). Mirrors Snake's own components/Theme.tsx.
export function Theme({ children }: Props) {
  const settings = useSelector((state: RootState) => state.theme, shallowEqual)
  const dispatch = useDispatch()
  const onChange = useCallback((next: ThemeSettings) => dispatch(themeActions.initialize(next)), [dispatch])
  // A one-shot callback, not a boolean, so there's nothing for useSplashReady to watch - PersistGate
  // (an ancestor, see Providers.tsx) already blocks this component from mounting until redux-persist
  // has rehydrated, so `settings` above is already the real persisted value the instant Theme mounts
  // (unlike the old AsyncStorage version, which needed `settings !== null` local-state gating to
  // avoid AutoPaperProvider's own lazy initializer locking in a still-loading value). This just marks
  // the 'theme' gate (see src/utils/splashGate.ts) once AutoPaperProvider has computed a real theme.
  const onReady = useCallback(() => markSplashReady('theme'), [])
  const bridgeProps = useThemeBridgeProps({ initialValue: settings, onChange, onReady })

  // expoBlur is what lets auto-paper's BlurView actually blur (the settings sheet, Paper menus and
  // @tastic/hud's overlay cards) while the player's Blur setting is on. Without it they paint the
  // theme's solid surface instead, and hud's Settings hides the Blur row.
  // statusBar={false}: auto-paper renders no React Native StatusBar (here or in Appbar.Header). The
  // status bar is set per screen (_layout.tsx's useRotationAwareStatusBar), and with @tastic/core's
  // config plugin on, a mounted StatusBar logs an error (a red box in a dev build).
  return (
    <AutoPaperProvider {...bridgeProps} expoBlur={ExpoBlur} statusBar={false}>
      {children}
    </AutoPaperProvider>
  )
}
