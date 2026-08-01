import { useCallback, useEffect, useRef, useState } from 'react'
import { prepareZXingModule } from 'barcode-detector'
import 'barcode-detector/polyfill'

/**
 * Camera + barcode detection.
 *
 * The `barcode-detector/polyfill` import only assigns `globalThis.BarcodeDetector`
 * when the browser doesn't already have one — so Chrome on Android uses the
 * native implementation (backed by Google Play Services, fast, no WASM
 * download) and everything else quietly falls back to ZXing WASM.
 */

/**
 * Serve the WASM from our own origin instead of the jsDelivr CDN it defaults
 * to. Without this the fallback path needs internet on first scan and reaches
 * out to a third party — neither of which fits an app that otherwise keeps
 * everything on-device. Chrome on Android never hits this code at all.
 */
prepareZXingModule({
  overrides: {
    locateFile: (filename: string, prefix: string) =>
      filename.endsWith('.wasm') ? `/${filename}` : prefix + filename,
  },
})

export type ScannerState = 'idle' | 'starting' | 'running' | 'denied' | 'error'

/** `torch` is real on Android but isn't in the DOM typings yet. */
type TorchConstraint = MediaTrackConstraintSet & { torch?: boolean }
type TorchCapabilities = MediaTrackCapabilities & { torch?: boolean }

interface UseScannerOptions {
  /** Fires once per accepted read, already de-duplicated. */
  onDetect: (value: string) => void
  /** Ignore repeats of the same value inside this window. */
  dedupeMs?: number
  enabled: boolean
}

export function useScanner({ onDetect, dedupeMs = 2500, enabled }: UseScannerOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const loopRef = useRef<number | null>(null)
  const recentRef = useRef<Map<string, number>>(new Map())
  // Keep the latest callback without restarting the camera on every render.
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  const [state, setState] = useState<ScannerState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)

  const stop = useCallback(() => {
    if (loopRef.current !== null) {
      clearInterval(loopRef.current)
      loopRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setTorchOn(false)
    setTorchAvailable(false)
    setState('idle')
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return
    setState('starting')
    setError(null)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream

      const video = videoRef.current
      if (!video) {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        return
      }

      video.srcObject = stream
      // `playsInline` matters on mobile — without it the video goes fullscreen.
      video.setAttribute('playsinline', 'true')
      await video.play()

      const [track] = stream.getVideoTracks()
      const capabilities = track?.getCapabilities?.() as TorchCapabilities | undefined
      setTorchAvailable(Boolean(capabilities?.torch))

      detectorRef.current = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'isbn' as never].filter(
          Boolean,
        ) as BarcodeFormat[],
      })

      setState('running')

      loopRef.current = window.setInterval(async () => {
        const detector = detectorRef.current
        const el = videoRef.current
        if (!detector || !el || el.readyState < 2) return

        let codes: DetectedBarcode[] = []
        try {
          codes = await detector.detect(el)
        } catch {
          return // transient decode failures are normal; just try the next frame
        }
        if (!codes.length) return

        const now = Date.now()
        for (const [value, seenAt] of recentRef.current) {
          if (now - seenAt > dedupeMs) recentRef.current.delete(value)
        }

        for (const code of codes) {
          const value = code.rawValue
          if (!value || recentRef.current.has(value)) continue
          recentRef.current.set(value, now)
          onDetectRef.current(value)
          break // one book at a time, even if two covers are in frame
        }
      }, 120)
    } catch (err) {
      const e = err as DOMException
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        setState('denied')
        setError('Camera access was blocked. Allow it in your browser settings and reload.')
      } else if (e.name === 'NotFoundError') {
        setState('error')
        setError('No camera found on this device.')
      } else {
        setState('error')
        setError(e.message || 'Could not start the camera.')
      }
    }
  }, [dedupeMs])

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as TorchConstraint] })
      setTorchOn(next)
    } catch {
      setTorchAvailable(false)
    }
  }, [torchOn])

  useEffect(() => {
    if (enabled) void start()
    else stop()
    return stop
  }, [enabled, start, stop])

  return { videoRef, state, error, torchOn, torchAvailable, toggleTorch, restart: start }
}
