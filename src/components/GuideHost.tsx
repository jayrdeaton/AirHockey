import { getViewRotation, useIsTouchPrimaryDevice, useOrientationState } from '@tastic/core'
import { GuideProvider } from '@tastic/hud/guide'
import { ReactNode, useCallback, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import { GUIDE_VERSION } from '@/constants/guide'
import { getGuideSteps } from '@/constants/guideSteps'
import { useGameSettings } from '@/hooks/useGameSettings'
import { guideActions, selectGuideVersionSeen } from '@/redux/guideSlice'
import type { RootState } from '@/redux/store'

interface Props {
  children: ReactNode
}

// Wires @tastic/hud/guide's provider to this app: the persisted "seen" version out of Redux, this
// app's own card content, and the live physical-hold rotation. Mounted once in _layout.tsx, wrapping
// the screen stack, so any screen can reach it through useGuide() (the Settings "How to Play" row)
// and useAutoShowGuide() (Home) without prop-drilling.
//
// Reads the rotation exactly the way Home (index.tsx) computes the one it hands its SettingsDialog
// (getViewRotation over useOrientationState(settings.lockOrientation)), so the guide's card, which
// only ever auto-shows over Home, sits at exactly the angle that dialog does. Its Portal renders
// outside any FakeLandscapeView, so unlike on-screen content it can't inherit that rotation and has
// to be handed it. `children` is the stable element _layout passes in, so a tilt-driven re-render
// here never re-renders the screen stack under it (same isolation _layout's
// ConnectedRotationAwareStatusBar relies on).
export function GuideHost({ children }: Props) {
  const { settings } = useGameSettings()
  const { orientationMode, p1OnRight, upsideDown } = useOrientationState(settings.lockOrientation)
  const rotation = getViewRotation(orientationMode, p1OnRight, upsideDown)
  const touch = useIsTouchPrimaryDevice()
  const seenVersion = useSelector((state: RootState) => selectGuideVersionSeen(state))
  const dispatch = useDispatch()

  const { controlScheme, scoreToWin } = settings
  const steps = useMemo(() => getGuideSteps({ touch, controlScheme, scoreToWin }), [touch, controlScheme, scoreToWin])
  const onSeen = useCallback((version: number) => dispatch(guideActions.markSeen(version)), [dispatch])

  return (
    <GuideProvider steps={steps} currentVersion={GUIDE_VERSION} seenVersion={seenVersion} onSeen={onSeen} rotation={rotation}>
      {children}
    </GuideProvider>
  )
}
