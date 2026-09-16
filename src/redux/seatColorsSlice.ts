import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR } from '@/constants/game'
import type { Player } from '@/types'

// /loadout's own dedicated "remember this for next time" memory — independent of the live theme
// snapshot (redux/store.ts's own `theme` slice, @rific/auto-paper's createThemeReducer). Mirrors
// Snake's redux/gameSlice.ts lastGuestColor/lastCpuColor fields one-for-one, just split into its
// own small slice (matching this app's own profileSelectionSlice.ts convention) rather than folded
// into a larger settings/game slice — AirHockey has no such slice of its own to extend, unlike Snake.
export type SeatColorsState = {
  // /loadout's own last-picked color per human seat, remembered only for whichever round that seat
  // was a guest (no profile selected) — a profile-selected seat's color always comes live from the
  // profile itself instead (see /loadout's own reconciliation effect), never from here.
  lastGuestColor: Record<Player, string>
  // Same idea as lastGuestColor, but for seat 2's CPU slot in Vs CPU — kept separate so a CPU
  // opponent's last color and a human guest's last color don't fight over one remembered value
  // (seat 1 is never CPU in this app — see types/index.ts's GameMode/PlayerSetupPanel's cpu wiring).
  lastCpuColor: string
}

export const defaultSeatColorsState: SeatColorsState = {
  lastGuestColor: { 1: DEFAULT_P1_COLOR, 2: DEFAULT_P2_COLOR },
  lastCpuColor: DEFAULT_P2_COLOR
}

const slice = createSlice({
  name: 'seatColors',
  initialState: defaultSeatColorsState,
  reducers: {
    setLastGuestColor: (state, action: PayloadAction<{ seat: Player; color: string }>) => ({
      ...state,
      lastGuestColor: { ...state.lastGuestColor, [action.payload.seat]: action.payload.color }
    }),
    setLastCpuColor: (state, action: PayloadAction<string>) => ({ ...state, lastCpuColor: action.payload })
  }
})

export const seatColorsActions = slice.actions
export default slice.reducer
