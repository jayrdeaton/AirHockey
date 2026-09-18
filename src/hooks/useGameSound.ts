// Thin re-export of @rific/feedback-press/audio's useGatedAudioPool — this app's own hand-rolled
// useGameSound was byte-for-byte identical (useAudioPool gated on useSoundSettings' `enabled`
// toggle). Kept under this app's own local name so no call site (game.tsx) needs to change its
// import.
export { useGatedAudioPool as useGameSound } from '@rific/feedback-press/audio'
