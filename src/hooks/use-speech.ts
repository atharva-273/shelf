import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice input via the Web Speech API — built into Chrome/Edge/Safari, free,
 * no key, no quota.
 *
 * It fills the search box; it never picks a result. A misheard title silently
 * adding the wrong book to a 400-book library is much worse than one extra tap.
 */

// Minimal typings — the prefixed interface isn't in lib.dom.
interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}
interface SpeechRecognitionResult {
  readonly length: number
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternative
}
interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = getRecognitionCtor() !== null

interface UseSpeechOptions {
  /** Live transcript, including interim guesses, so she can see it working. */
  onTranscript: (text: string, isFinal: boolean) => void
  /**
   * en-IN materially outperforms en-US on Indian author and title names —
   * "Arundhati Roy", "Chimamanda Ngozi Adichie" and so on.
   */
  lang?: string
}

export function useSpeech({ onTranscript, lang = 'en-IN' }: UseSpeechOptions) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    recognitionRef.current?.abort()
    setError(null)

    const recognition = new Ctor()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setListening(true)

    recognition.onresult = (event) => {
      let text = ''
      let isFinal = false
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        text += result[0].transcript
        if (result.isFinal) isFinal = true
      }
      onTranscriptRef.current(text.trim(), isFinal)
    }

    recognition.onerror = (event) => {
      setListening(false)
      switch (event.error) {
        case 'not-allowed':
        case 'service-not-allowed':
          setError('Microphone access was blocked.')
          break
        case 'no-speech':
          setError("Didn't catch that — try again.")
          break
        case 'aborted':
          break
        default:
          setError('Voice input failed. Type it instead.')
      }
    }

    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      // start() throws if called while already running — harmless.
    }
  }, [lang])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  useEffect(() => () => recognitionRef.current?.abort(), [])

  return { supported: speechSupported, listening, error, start, stop, toggle }
}
