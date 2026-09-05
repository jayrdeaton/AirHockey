import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

import { MONO_FONT } from '@/constants/fonts'

export interface HeroTitleProps {
  color: string
  // The live theme's p1/p2 colors — whatever the players actually picked (see Theme.tsx), not a
  // fixed pair — so the paddles rallying beneath the title always match the real in-game colors.
  p1Color: string
  p2Color: string
}

const WORD_TOP = 'AIR'
const WORD_BOTTOM = 'HOCKEY'
const TOTAL_LETTERS = WORD_TOP.length + WORD_BOTTOM.length

const STAGGER_MS = 45
const LETTER_DURATION_MS = 320
const TOTAL_STAGGER_MS = (TOTAL_LETTERS - 1) * STAGGER_MS + LETTER_DURATION_MS

// The paddles (and the puck they volley) stay hidden until the wordmark has mostly landed — one
// "power on" beat once the letters settle, rather than motion competing with letters still flying
// in — then the rally itself runs forever.
const RALLY_DELAY_MS = Math.round(TOTAL_STAGGER_MS * 0.7)
const PADDLE_IN_MS = 260
const LEG_MS = 520
const ARC_HEIGHT = 6

const PADDLE_SIZE = 20
const PADDLE_RING_SIZE = 11
const PUCK_SIZE = 12
const TRACK_WIDTH = 60
const HALF_TRAVEL = (TRACK_WIDTH - PUCK_SIZE) / 2

function AnimatedLetter({ char, index, color, reducedMotion }: { char: string; index: number; color: string; reducedMotion: boolean }) {
  const progress = useSharedValue(reducedMotion ? 1 : 0)

  useEffect(() => {
    if (reducedMotion) return
    progress.value = withDelay(index * STAGGER_MS, withTiming(1, { duration: LETTER_DURATION_MS, easing: Easing.out(Easing.back(1.5)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.85 + progress.value * 0.15 }]
  }))

  return (
    <Animated.Text allowFontScaling={false} style={[styles.letter, { color }, style]}>
      {char}
    </Animated.Text>
  )
}

function Word({ text, startIndex, color, reducedMotion }: { text: string; startIndex: number; color: string; reducedMotion: boolean }) {
  return (
    <View style={styles.word}>
      {text.split('').map((char, i) => (
        <AnimatedLetter key={i} char={char} index={startIndex + i} color={color} reducedMotion={reducedMotion} />
      ))}
    </View>
  )
}

// Bespoke hero for this game: two staggered lines of letters, then two paddles fade in and volley
// the puck back and forth forever — styled after the real in-game mallets (see Board.tsx) so the
// rally reads as an echo of actual gameplay, not just decoration.
export function HeroTitle({ color, p1Color, p2Color }: HeroTitleProps) {
  const reducedMotion = useReducedMotion()

  const entrance = useSharedValue(reducedMotion ? 1 : 0)
  useEffect(() => {
    if (reducedMotion) return
    entrance.value = withDelay(RALLY_DELAY_MS, withTiming(1, { duration: PADDLE_IN_MS, easing: Easing.out(Easing.cubic) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  // Rally position: 0 = puck at the left paddle, 1 = at the right paddle. Runs 0→1→0→1… forever
  // once the paddles have landed, so the same value also drives each paddle's "just made contact"
  // pulse below — no separate hit-detection state needed.
  const t = useSharedValue(reducedMotion ? 0.5 : 0)
  useEffect(() => {
    if (reducedMotion) return
    t.value = withDelay(RALLY_DELAY_MS + PADDLE_IN_MS, withRepeat(withSequence(withTiming(1, { duration: LEG_MS, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: LEG_MS, easing: Easing.inOut(Easing.quad) })), -1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: 0.85 + entrance.value * 0.15 }]
  }))
  const leftPaddleStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(t.value, [0, 0.18], [1.22, 1], 'clamp') }] }))
  const rightPaddleStyle = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(t.value, [0.82, 1], [1, 1.22], 'clamp') }] }))
  const puckStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(t.value, [0, 1], [-HALF_TRAVEL, HALF_TRAVEL]) }, { translateY: -Math.sin(t.value * Math.PI) * ARC_HEIGHT }]
  }))

  return (
    <View style={styles.wrapper}>
      <Word text={WORD_TOP} startIndex={0} color={color} reducedMotion={reducedMotion} />
      <Word text={WORD_BOTTOM} startIndex={WORD_TOP.length} color={color} reducedMotion={reducedMotion} />

      <Animated.View style={[styles.lineRow, entranceStyle]}>
        <Animated.View style={[styles.paddle, { backgroundColor: p1Color }, leftPaddleStyle]}>
          <View style={styles.paddleRing} />
        </Animated.View>

        <View style={styles.track}>
          <Animated.View pointerEvents='none' style={[styles.puck, { backgroundColor: color }, puckStyle]} />
        </View>

        <Animated.View style={[styles.paddle, { backgroundColor: p2Color }, rightPaddleStyle]}>
          <View style={styles.paddleRing} />
        </Animated.View>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  letter: {
    fontFamily: MONO_FONT,
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 4,
    lineHeight: 48
  },
  lineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 14
  },
  paddle: {
    alignItems: 'center',
    borderRadius: PADDLE_SIZE / 2,
    height: PADDLE_SIZE,
    justifyContent: 'center',
    width: PADDLE_SIZE
  },
  paddleRing: {
    backgroundColor: '#FFFFFF',
    borderRadius: PADDLE_RING_SIZE / 2,
    height: PADDLE_RING_SIZE,
    opacity: 0.35,
    width: PADDLE_RING_SIZE
  },
  puck: {
    borderRadius: PUCK_SIZE / 2,
    height: PUCK_SIZE,
    width: PUCK_SIZE
  },
  track: {
    alignItems: 'center',
    height: PADDLE_SIZE,
    justifyContent: 'center',
    width: TRACK_WIDTH
  },
  word: {
    flexDirection: 'row'
  },
  wrapper: {
    alignItems: 'center'
  }
})
