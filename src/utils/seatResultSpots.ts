import type { Player } from '@/types'

/** One 2 Player seat's Game Over card: the half of the screen that's theirs (the screen as the app lays it out, portrait-locked, so 'top'
 * is the device's own top half however it's held) and the angle it's turned to face them. */
export interface SeatSpot {
  rotation: 0 | 90 | 180 | -90
  zone: 'bottom' | 'left' | 'right' | 'top'
}

/** Where each 2 Player seat's Game Over card goes, from the rink's rotation (game.tsx's `rotationDeg`). An upright rink (every 2 Player
 * match on a phone, face to face however it's held) has player 1 at the bottom and player 2 at the top, each card facing its own end. A
 * turned one (a browser window wider than tall) has player 1 at the end the rink's bottom turned to (left at 90, right at -90), both
 * upright. A computer screen keeps both upright, since its players sit side by side whatever its shape. */
export function seatResultSpots(rinkRotation: 0 | 90 | -90, desktopWeb: boolean): Record<Player, SeatSpot> {
  if (rinkRotation === 90) return { 1: { rotation: 0, zone: 'left' }, 2: { rotation: 0, zone: 'right' } }
  if (rinkRotation === -90) return { 1: { rotation: 0, zone: 'right' }, 2: { rotation: 0, zone: 'left' } }
  return { 1: { rotation: 0, zone: 'bottom' }, 2: { rotation: desktopWeb ? 0 : 180, zone: 'top' } }
}
