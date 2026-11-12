import Image from 'next/image'
import type { ReactNode } from 'react'
import { PHOTOS, SHOT_ALT, type Photo as PhotoName, type Shot } from '@/content/guide'

type Lang = 'es' | 'en'
/** Capturas: móvil 390 x 844 a 2x; escritorio 1440 x 900 a 1.25x (scripts/landing-shots.mjs). */
const M = { w: 780, h: 1688 }
const D = { w: 1800, h: 1125 }
export const shotSrc = (shot: Shot, size: 'm' | 'd', lang: Lang) => `/landing/${shot}-${size}-${lang}.webp`

/** Marco de teléfono con una captura real, o con lo que se le pase (la demo). */
export function Phone({ shot, lang, sizes = '280px', small, priority, decorative, className, children }: { shot?: Shot; lang?: Lang; sizes?: string; small?: boolean; priority?: boolean; decorative?: boolean; className?: string; children?: ReactNode }) {
  return (
    <div className={`sc-phone ${small ? 'sc-phone-sm' : ''} ${className ?? ''}`}>
      <div className="sc-phone-screen">
        {shot && lang ? <Image src={shotSrc(shot, 'm', lang)} width={M.w} height={M.h} sizes={sizes} alt={decorative ? '' : SHOT_ALT[shot][lang]} priority={priority} className="block h-auto w-full" /> : children}
      </div>
    </div>
  )
}

/** Marco de navegador con la captura de escritorio. */
export function Browser({ shot, lang, sizes = '(min-width: 1200px) 940px, 86vw', decorative, className }: { shot: Shot; lang: Lang; sizes?: string; decorative?: boolean; className?: string }) {
  return (
    <div className={`sc-browser ${className ?? ''}`}>
      <div className="sc-browser-bar" aria-hidden>
        <i />
        <i />
        <i />
        <b />
      </div>
      <Image src={shotSrc(shot, 'd', lang)} width={D.w} height={D.h} sizes={sizes} alt={decorative ? '' : SHOT_ALT[shot][lang]} className="block h-auto w-full" />
    </div>
  )
}

/** Foto de archivo tratada para la marca: recorte redondeado, color bajado y velo verde sobre negro. */
export function Photo({ name, lang, sizes, className, fade, position, priority, children }: { name: PhotoName; lang: Lang; sizes: string; className?: string; fade?: boolean; position?: string; priority?: boolean; children?: ReactNode }) {
  const p = PHOTOS[name]
  return (
    <figure className={`sc-photo ${fade ? 'sc-photo-fade' : ''} ${className ?? ''}`}>
      <Image src={`/landing/foto-${name}.webp`} alt={p.alt[lang]} fill sizes={sizes} priority={priority} style={{ objectPosition: position ?? 'center' }} />
      {children && <figcaption className="absolute inset-x-0 bottom-0 z-[3] p-5">{children}</figcaption>}
    </figure>
  )
}
