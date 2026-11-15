import { useEffect, useRef, useState } from 'react'
import { useI18n } from './i18n.tsx'

function createAmbientSound() {
  const context = new AudioContext()
  const volume = context.createGain()
  volume.gain.value = 0.028
  volume.connect(context.destination)

  // Each voice in this quiet chord fades in and out independently.
  const tones = [55, 82.41, 110, 164.81]
  tones.forEach((frequency, index) => {
    const tone = context.createOscillator()
    const swell = context.createOscillator()
    const depth = context.createGain()
    const voice = context.createGain()
    tone.type = index === 0 ? 'triangle' : 'sine'
    tone.frequency.value = frequency
    swell.frequency.value = 0.08 + index * 0.025
    depth.gain.value = 0.1
    voice.gain.value = 0.14
    swell.connect(depth).connect(voice.gain)
    tone.connect(voice).connect(volume)
    tone.start()
    swell.start()
  })
  return context
}

export function SoundToggle() {
  const { t } = useI18n()
  const contextRef = useRef<AudioContext | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => () => { void contextRef.current?.close().catch(() => {}) }, [])

  async function toggle() {
    setPending(true)
    setFailed(false)
    try {
      const context = contextRef.current ?? (contextRef.current = createAmbientSound())
      if (enabled) await context.suspend()
      else await context.resume()
      setEnabled(!enabled)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }

  return <>
    <button type="button" className="orbital-sound" aria-label={t('sound.label')} aria-pressed={enabled}
      title={t(enabled ? 'sound.off' : 'sound.on')} disabled={pending || typeof AudioContext === 'undefined'} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 9h4l5-4v14l-5-4H3z"/>
        {enabled ? <path d="M15 9a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12"/> : <path d="m16 10 5 5m0-5-5 5"/>}
      </svg>
    </button>
    {failed && <span className="sr-only" role="status">{t('sound.unavailable')}</span>}
  </>
}
