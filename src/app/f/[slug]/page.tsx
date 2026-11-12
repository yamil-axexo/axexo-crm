import Image from 'next/image'
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { withoutUser } from '@/server/db'
import { translator, type Locale } from '@/lib/format'
import { Field } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { submitPublicForm } from './actions'
import { ATTRIBUTION_KEYS, CONSENT_TEXT, cleanAttribution } from '@/domain/leads'

export default async function PublicForm({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params
  // De dónde llegó la persona: los parámetros de campaña y de clic de la dirección viajan con el formulario.
  const sp = await searchParams
  const origin = ATTRIBUTION_KEYS.flatMap((k) => {
    const raw = sp[k]
    const v = cleanAttribution(Array.isArray(raw) ? raw[0] : raw)
    return v ? [[k, v] as const] : []
  })
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) notFound()
  const rows = await withoutUser((tx) => tx<{ name: string; locale: Locale; market_code: string }[]>`select name, locale, market_code from app.form_public(${slug})`)
  const form = rows[0]
  if (!form) notFound()
  const t = translator(form.locale)
  return (
    <main className="mx-auto max-w-[560px] px-6 py-14">
      <Image src="/contigo-on-light.png" alt="axexo CONTIGO" width={200} height={50} className="h-10 w-auto" />
      <section className="card mt-8 p-8">
        <h1 className="text-[26px] font-bold">{form.name}</h1>
        <p className="mt-2 text-[14px] text-muted-2">{t('Déjanos tus datos y te contactamos.', 'Leave your details and we will reach out.')}</p>
        <ActionForm action={submitPublicForm} onOk="reset" className="mt-7 space-y-4" testId="public-form">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <input type="hidden" name="locale" value={form.locale === 'en' ? 'en' : 'es'} />
          {origin.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="hidden" aria-hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          <Field label={t('Nombre del negocio', 'Business name')}><input name="business_name" className="input" required minLength={2} maxLength={120} /></Field>
          <Field label={t('Tu nombre', 'Your name')}><input name="contact_name" className="input" required minLength={2} maxLength={120} /></Field>
          <Field label={t('Teléfono', 'Phone')}><input name="phone" className="input" inputMode="tel" required /></Field>
          <Field label={t('Correo (opcional)', 'Email (optional)')}><input name="email" type="email" className="input" /></Field>
          <Field label={t('Ciudad', 'City')}><input name="locality" className="input" /></Field>
          <Field label={t('¿Algo que debamos saber?', 'Anything we should know?')}><textarea name="message" rows={3} className="input" maxLength={1000} /></Field>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[14px] text-muted-2">
            <input type="checkbox" name="consent" className="mt-0.5 h-5 w-5 shrink-0" data-testid="public-consent" />
            <span>{t(CONSENT_TEXT.es, CONSENT_TEXT.en)} <span className="text-muted">{t('Es opcional.', 'This is optional.')}</span></span>
          </label>
          <Submit testId="public-submit">{t('Enviar', 'Send')}</Submit>
        </ActionForm>
      </section>
    </main>
  )
}
