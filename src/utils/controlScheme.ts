import { Direction, resolveSchemeDirection } from '@tastic/input'

import { ControlScheme } from '@/types'

// The one shared entry point KeyboardInputLayer routes every keydown/keyup through. 'mouse' (the
// scheme with no keys of its own - see types/index.ts's own ControlScheme doc) always resolves to
// null; every other scheme is a KeyScheme, resolved by @tastic/input's own resolveSchemeDirection
// (which already knows numpad's NumLock-independent .code quirk - see that package's own doc).
export function resolveControlSchemeDirection(event: Pick<KeyboardEvent, 'key' | 'code'>, scheme: ControlScheme): Direction | null {
  if (scheme === 'mouse') return null
  return resolveSchemeDirection(event, scheme)
}
