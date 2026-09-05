import { resolveControlSchemeDirection } from '@/utils/controlScheme'

describe('resolveControlSchemeDirection', () => {
  it('returns null for the mouse scheme regardless of key', () => {
    expect(resolveControlSchemeDirection({ key: 'w', code: 'KeyW' }, 'mouse')).toBeNull()
    expect(resolveControlSchemeDirection({ key: 'ArrowUp', code: 'ArrowUp' }, 'mouse')).toBeNull()
  })

  it('resolves wasd by key', () => {
    expect(resolveControlSchemeDirection({ key: 'w', code: 'KeyW' }, 'wasd')).toBe('up')
    expect(resolveControlSchemeDirection({ key: 'd', code: 'KeyD' }, 'wasd')).toBe('right')
  })

  it('resolves arrows by key', () => {
    expect(resolveControlSchemeDirection({ key: 'ArrowLeft', code: 'ArrowLeft' }, 'arrows')).toBe('left')
  })

  it('resolves ijkl by key', () => {
    expect(resolveControlSchemeDirection({ key: 'j', code: 'KeyJ' }, 'ijkl')).toBe('left')
  })

  it('resolves numpad by code, independent of NumLock (.key may read as a digit or an arrow name)', () => {
    expect(resolveControlSchemeDirection({ key: '4', code: 'Numpad4' }, 'numpad')).toBe('left')
    expect(resolveControlSchemeDirection({ key: 'ArrowRight', code: 'Numpad6' }, 'numpad')).toBe('right')
  })

  it('returns null for a key not in the given scheme', () => {
    expect(resolveControlSchemeDirection({ key: 'q', code: 'KeyQ' }, 'wasd')).toBeNull()
  })
})
