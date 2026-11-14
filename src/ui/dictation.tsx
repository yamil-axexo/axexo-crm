'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Mic, Square } from 'lucide-react'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
type RecognitionCtor = new () => Recognition
const never = () => () => {}
const speechCtor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/**
 * IA-01: dictado con el reconocimiento de voz del propio navegador (no es un servicio que CONTIGO conecte). Si el navegador no
 * lo tiene, el botón no aparece. Lo dictado cae en el campo como borrador: la persona lo lee, lo corrige y recién entonces guarda.
 * CONTIGO no graba ni guarda audio.
 */
export function DictationField({ name, label, locale, rows = 3, testId }: { name: string; label: string; locale: 'es' | 'en'; rows?: number; testId?: string }) {
  // Se decide en el navegador: el servidor no sabe cuál es. Sin reconocimiento de voz, no hay botón.
  const ctor = useSyncExternalStore(never, speechCtor, () => null)
  const [on, setOn] = useState(false)
  const [dictated, setDictated] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const rec = useRef<Recognition | null>(null)
  const t = (es: string, en: string) => (locale === 'en' ? en : es)

  useEffect(() => () => rec.current?.stop(), [])

  const toggle = () => {
    if (!ctor) return
    if (on) {
      rec.current?.stop()
      return
    }
    const r = new ctor()
    r.lang = locale === 'en' ? 'en-US' : 'es-MX'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      let text = ''
      for (let i = e.resultIndex; i < e.results.length; i += 1) if (e.results[i]!.isFinal) text += e.results[i]![0].transcript
      if (!text || !ref.current) return
      const cur = ref.current.value
      ref.current.value = `${cur}${cur && !cur.endsWith(' ') ? ' ' : ''}${text.trim()}`
      setDictated(true)
    }
    r.onend = () => setOn(false)
    r.onerror = () => setOn(false)
    rec.current = r
    r.start()
    setOn(true)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={`f-${name}`} className="text-[13.5px] font-medium text-strong">{label}</label>
        {ctor && (
          <button type="button" onClick={toggle} aria-pressed={on} className="press inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-[13px] font-medium text-strong hover:bg-green-50" data-testid="dictate">
            {on ? <Square size={16} strokeWidth={1.75} aria-hidden /> : <Mic size={16} strokeWidth={1.75} aria-hidden />}
            {on ? t('Detener dictado', 'Stop dictation') : t('Dictar', 'Dictate')}
          </button>
        )}
      </div>
      <textarea id={`f-${name}`} ref={ref} name={name} rows={rows} className="input !h-auto py-3" data-testid={testId} />
      <input type="hidden" name="dictated" value={dictated ? '1' : ''} />
      {(on || dictated) && (
        <p role="status" className="mt-2 text-[13px] text-muted" data-testid="dictation-review">
          {on ? t('Escuchando. Habla con calma; el texto aparece al terminar cada frase.', 'Listening. Speak calmly; the text appears when each sentence ends.')
            : t('Revisa el texto antes de guardar: el dictado puede equivocarse. No dictes datos de tarjetas, cuentas ni identificaciones.', 'Check the text before saving: dictation can get things wrong. Do not dictate card, account or ID numbers.')}
        </p>
      )}
    </div>
  )
}
