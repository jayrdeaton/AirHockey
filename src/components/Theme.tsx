import AsyncStorage from '@react-native-async-storage/async-storage'
import { getRgb, getThirdColor, Provider as AutoPaperProvider, ThemeSettings } from '@rific/auto-paper'
import * as SplashScreen from 'expo-splash-screen'
import { ReactNode, useCallback, useEffect, useState } from 'react'

import { useSplashReady } from '@/utils/splashGate'

SplashScreen.preventAutoHideAsync()
// iOS defaults `fade` to false (Android always fades regardless of this flag), so without this the
// splash view is just yanked off screen the instant every gate reports ready.
SplashScreen.setOptions({ fade: true, duration: 400 })

// Prefixed distinctly from BoxHockey's own `boxhockey.*` keys so a device with both games
// installed never cross-contaminates appearance/color settings.
const APPEARANCE_STORAGE_KEY = 'airhockey.appearance'
// Doubles as the cold-boot default (what tints the app before /loadout has ever mounted) and the
// per-seat "guest" color memory — a human seat with no profile selected. CPU's own remembered
// color lives at its own key below instead, so the two never fight over one slot — see
// loadCpuColor/saveCpuColor and loadout.tsx's own seat-color reconciliation.
const PLAYER_COLORS_STORAGE_KEY = 'airhockey.playerColors'
const CPU_COLOR_STORAGE_KEY = 'airhockey.cpuColor'

export const DEFAULT_P1_COLOR = '#f44336'
export const DEFAULT_P2_COLOR = '#2196f3'

function triadFor(p1: string, p2: string) {
  return { primary: p1, secondary: p2, tertiary: getThirdColor(p1, p2) }
}

function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && getRgb(value) !== null
}

export async function loadGuestColors(): Promise<{ p1: string; p2: string }> {
  let p1 = DEFAULT_P1_COLOR
  let p2 = DEFAULT_P2_COLOR
  try {
    const stored = await AsyncStorage.getItem(PLAYER_COLORS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (isValidHex(parsed.p1)) p1 = parsed.p1
      if (isValidHex(parsed.p2)) p2 = parsed.p2
    }
  } catch {
    // Corrupt/stale blob — fall back to defaults above.
  }
  return { p1, p2 }
}

// Fire-and-forget, matching every other seat/settings persistence call in this app (useGameSettings,
// useProfiles) — nothing here needs to await the write landing.
export function saveGuestColors(colors: { p1: string; p2: string }): void {
  void AsyncStorage.setItem(PLAYER_COLORS_STORAGE_KEY, JSON.stringify(colors))
}

export async function loadCpuColor(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(CPU_COLOR_STORAGE_KEY)
    if (isValidHex(stored)) return stored
  } catch {
    // Corrupt/unavailable value — fall back to the default below.
  }
  return DEFAULT_P2_COLOR
}

export function saveCpuColor(hex: string): void {
  void AsyncStorage.setItem(CPU_COLOR_STORAGE_KEY, hex)
}

interface Props {
  children: ReactNode
}

export function Theme({ children }: Props) {
  const [settings, setSettings] = useState<Partial<ThemeSettings> | null>(null)

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(APPEARANCE_STORAGE_KEY), loadGuestColors()]).then(([storedAppearance, guestColors]) => {
      const appearance = storedAppearance === 'light' || storedAppearance === 'dark' || storedAppearance === 'system' ? storedAppearance : 'dark'
      setSettings({ appearance, color: triadFor(guestColors.p1, guestColors.p2) })
    })
  }, [])

  // Loaded settings gate mounting AutoPaperProvider entirely (rather than mounting it immediately
  // with defaults and patching `initialValue` once the read resolves): AutoPaperProvider's own
  // `settings` state is a lazy useState(() => ...) that only reads `initialValue` on its very first
  // mount, so a changed `initialValue` prop on a later render is silently ignored — persistence
  // would appear to work (this component's own state updates) while the live theme never actually
  // picks it up. Splash stays up for this window regardless (see useSplashReady below), so gating
  // costs nothing visually.
  useSplashReady('theme', settings !== null)

  // Only persists appearance — AutoPaperProvider owns the live settings after mount, and calling
  // setSettings here too would update this parent component while the provider (a child) is
  // rendering. Player colors are deliberately NOT persisted here: this callback fires on every
  // color change regardless of why it happened, and only /loadout knows whether a given change
  // came from a selected profile (never persisted — the profile's own saved color stays the
  // source of truth) or an actual guest/CPU recolor. Persisting unconditionally here is what used
  // to let a profile-driven repaint drift into and overwrite the guest slot; loadout.tsx now owns
  // that decision itself via saveGuestColors/saveCpuColor.
  const onChange = useCallback((next: ThemeSettings) => {
    void AsyncStorage.setItem(APPEARANCE_STORAGE_KEY, next.appearance)
  }, [])

  if (!settings) return null

  return (
    <AutoPaperProvider initialValue={settings} onChange={onChange}>
      {children}
    </AutoPaperProvider>
  )
}
