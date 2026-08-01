/**
 * Scan feedback. The beep and buzz fire the instant the camera sees a code —
 * before any network call — so a sweep feels instant even when the lookup
 * takes a second.
 */

let audioContext: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!audioContext) {
    try {
      audioContext = new AudioContext()
    } catch {
      return null
    }
  }
  // Browsers suspend the context until a user gesture has occurred.
  if (audioContext.state === 'suspended') void audioContext.resume()
  return audioContext
}

function tone(frequency: number, durationMs: number, volume = 0.06) {
  const ctx = context()
  if (!ctx) return

  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.value = frequency
  gain.gain.setValueAtTime(volume, ctx.currentTime)
  // Ramp down so it clicks rather than pops.
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000)

  oscillator.connect(gain).connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + durationMs / 1000)
}

function buzz(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern)
  }
}

/** A code was seen and accepted. */
export function feedbackHit() {
  tone(880, 90)
  buzz(18)
}

/** Already in the library. */
export function feedbackDuplicate() {
  tone(560, 70)
  setTimeout(() => tone(560, 70), 110)
  buzz([14, 60, 14])
}

/** Scanned fine, but nothing came back — she'll need to search for it. */
export function feedbackMiss() {
  tone(320, 160, 0.05)
  buzz([28, 50, 28])
}

/** Prime the audio context on first user gesture so the first beep isn't silent. */
export function primeAudio() {
  const ctx = context()
  if (ctx?.state === 'suspended') void ctx.resume()
}
