import Image from 'next/image'
import { notFound } from 'next/navigation'
import { systemCtx } from '@/server/context'
import { onboardingLinkUsed, onboardingLinkView } from '@/domain/campo-canal/expediente'
import { translator } from '@/lib/format'
import { Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { linkReceiveAction, linkSubmitAction } from './actions'

export const dynamic = 'force-dynamic'

/**
 * CAMPO-06: enlace de captura del expediente. Sin sesión: el código del enlace es la llave, vence solo y sirve para un
 * expediente. Quien lo abre ve el nombre de su tienda y su lista de documentos, y deja el enlace https de cada uno.
 * Nunca se sube un archivo a CONTIGO.
 */
export default async function OnboardingLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound()
  const sys = await systemCtx()
  const v = await onboardingLinkView(sys, token)
  const t = translator(v?.locale ?? 'es')
  if (!v && (await onboardingLinkUsed(sys, token))) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-14">
        <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={200} height={50} className="h-10 w-auto" />
        <section className="card mt-8 p-8" data-testid="link-sent">
          <h1 className="text-[22px] font-bold">{t('Recibimos tus documentos', 'We received your documents')}</h1>
          <p className="mt-2 text-[14px] text-muted-2">{t('Los estamos revisando. Si falta algo, quien te visitó te avisa.', 'We are reviewing them. If anything is missing, whoever visited you will let you know.')}</p>
        </section>
      </main>
    )
  }
  if (!v) {
    return (
      <main className="mx-auto max-w-[560px] px-6 py-14">
        <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={200} height={50} className="h-10 w-auto" />
        <section className="card mt-8 p-8" data-testid="link-gone">
          <h1 className="text-[22px] font-bold">{t('Este enlace ya no sirve', 'This link no longer works')}</h1>
          <p className="mt-2 text-[14px] text-muted-2">{t('Venció, ya se usó o lo reemplazaron. Pide uno nuevo a quien te visitó.', 'It expired, was already used or was replaced. Ask whoever visited you for a new one.')}</p>
        </section>
      </main>
    )
  }
  const missing = v.docs.filter((d) => d.status === 'missing' || d.status === 'rejected').length
  return (
    <main className="mx-auto max-w-[640px] px-6 py-14">
      <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={200} height={50} className="h-10 w-auto" />
      <section className="card mt-8 p-8" data-testid="link-page">
        <h1 className="text-[24px] font-bold">{t(`Documentos de ${v.store}`, `Documents for ${v.store}`)}</h1>
        <p className="mt-2 text-[14px] text-muted-2">{t('Para cada documento, pega el enlace seguro (https) donde lo tienes guardado. No subas archivos aquí ni escribas números de tarjeta o de cuenta.', 'For each document, paste the secure link (https) where you keep it. Do not upload files here or type card or account numbers.')}</p>
        <ul className="mt-6">
          {v.docs.map((d) => (
            <li key={d.id} className="border-t border-line py-4 first:border-t-0" data-testid="link-doc" data-status={d.status}>
              <p className="text-[15px] font-semibold text-strong">{t(d.label_es, d.label_en)} <span className="text-[13px] font-normal text-muted-2">· {d.status === 'missing' ? t('Falta', 'Missing') : d.status === 'rejected' ? t('Hay que corregirlo', 'Needs fixing') : t('Recibido', 'Received')}</span></p>
              <ActionForm action={linkReceiveAction} className="mt-2 flex flex-wrap items-end gap-2" testId="link-doc-form">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="doc" value={d.id} />
                <input type="hidden" name="locale" value={v.locale} />
                <div className="min-w-0 flex-1 basis-60"><Field label={t('Enlace', 'Link')}><input name="link" type="url" placeholder="https://" className="input" required /></Field></div>
                <Submit size="sm" variant="ghost">{t('Guardar', 'Save')}</Submit>
              </ActionForm>
            </li>
          ))}
        </ul>
        <ActionForm action={linkSubmitAction} className="mt-6 border-t border-line pt-6" testId="link-submit">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="locale" value={v.locale} />
          <p className="mb-3 text-[13.5px] text-muted-2">{missing > 0 ? t(`Faltan ${missing}. Cuando estén todos, envíalo a revisión.`, `${missing} still missing. Once they are all in, send it for review.`) : t('Ya están todos. Envíalo a revisión.', 'They are all in. Send it for review.')}</p>
          <Submit testId="link-submit-btn">{t('Enviar a revisión', 'Send for review')}</Submit>
        </ActionForm>
      </section>
    </main>
  )
}
