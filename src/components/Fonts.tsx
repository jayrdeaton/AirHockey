import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useFonts } from 'expo-font'
import { ReactNode } from 'react'

import { SplashGate } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until the
// MaterialCommunityIcons glyph font has actually loaded - otherwise every react-native-paper
// Icon/IconButton (and @rific/feedback-press's IconButton, which wraps paper's under the hood)
// would render blank for one visible frame before snapping in once the async load resolves.
// Gated via the Gate component (SplashGate, per splashGate.ts's own alias) rather than a
// hand-rolled `useSplashReady` call plus an unconditional `<>{children}</>` - that combination
// only ever held the NATIVE splash screen up, not the JS tree itself, so a react-native-paper icon
// could still render blank for one frame before the font resolved even though the native splash
// had already waited for it. Matches Pong's own fix for the identical gap.
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ ...MaterialCommunityIcons.font })
  return (
    <SplashGate gate='fonts' ready={loaded}>
      {children}
    </SplashGate>
  )
}
