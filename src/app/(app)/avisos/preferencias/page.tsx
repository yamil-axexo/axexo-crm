import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { myPrefs } from '@/dal/notices'
import { channelStatus } from '@/server/adapters/channels'
import { Card, CardTitle, PageHeader } from '@/ui/kit'
import { ActionForm, Submit } from '@/ui/client'
import { CHANNELS, CHANNEL_LABEL, KIND_KEYS, NOTICE_KINDS, wants, type KindDef } from '@/lib/notice-kinds'
import { savePrefsAction } from '../actions'

export const dynamic = 'force-dynamic'

/** Preferencias de avisos de la persona: qué tipos recibe, por qué canal, y si quiere un resumen diario. */
export default async function PrefsPage() {
  const ctx = await requireCtx()
  const { t } = ctx
  const mine = await myPrefs(ctx)
  const off = new Set(channelStatus().filter((c) => c.mode === 'off').map((c) => c.channel as string))
  return (
    <div data-testid="notice-prefs">
      <p className="mb-3"><Link href="/avisos" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline">{t('Volver a Avisos', 'Back to Notices')}</Link></p>
      <PageHeader title={t('Preferencias de avisos', 'Notice preferences')} desc={t('Elige qué quieres recibir y por dónde. Dentro de CONTIGO llega al momento.', 'Choose what you want to receive and where. Inside CONTIGO it arrives right away.')} />
      {off.size > 0 && (
        <p role="note" className="mb-6 rounded-[14px] bg-surface-3 px-5 py-4 text-[14px] text-strong" data-testid="prefs-off-note">
          {t('Correo, Slack y WhatsApp están apagados por ahora: CONTIGO guarda tu elección y no manda nada por esos canales hasta que se enciendan.', 'Email, Slack and WhatsApp are turned off for now: CONTIGO keeps your choice and sends nothing through those channels until they are turned on.')}
        </p>
      )}
      <ActionForm action={savePrefsAction} testId="prefs-form">
        <Card pad={false}>
          <div className="px-5 pt-6 md:px-7"><CardTitle title={t('Qué recibes y por dónde', 'What you receive and where')} /></div>
          <ul className="divide-y divide-line border-t border-line">
            {KIND_KEYS.map((k) => {
              const def: KindDef = NOTICE_KINDS[k]
              return (
                <li key={k} className="px-5 py-4 md:px-7" data-testid={`pref-${k}`}>
                  <fieldset>
                    <legend className="text-[15px] font-semibold text-strong">{t(...def.label)}</legend>
                    <p className="text-[13px] text-muted-2">{t(...def.hint)}{def.locked ? ` ${t('Dentro de CONTIGO no se puede apagar.', 'It cannot be turned off inside CONTIGO.')}` : ''}</p>
                    <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0">
                      {CHANNELS.map((c) => (
                        <label key={c} className="flex min-h-11 items-center gap-2 text-[14px] text-strong">
                          <input type="checkbox" name="on" value={`${k}:${c}`} defaultChecked={wants(mine.prefs, k, c)} disabled={c === 'in_app' && def.locked} className="h-5 w-5" data-testid={`pref-${k}-${c}`} />
                          {t(...CHANNEL_LABEL[c])}{off.has(c) ? <span className="text-[12.5px] text-muted-2">({t('apagado', 'off')})</span> : null}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </li>
              )
            })}
          </ul>
        </Card>
        <Card className="mt-6">
          <CardTitle title={t('Resumen diario', 'Daily summary')} hint={t('En vez de un mensaje por cada aviso, uno solo al día por cada canal de afuera. Lo urgente (un lead que llega, una devolución, un anuncio) sale igual al momento.', 'Instead of one message per notice, a single one a day for each outside channel. Urgent ones (a lead arriving, a return, an announcement) still go out right away.')} />
          <label className="flex min-h-11 items-center gap-2 text-[14.5px] text-strong">
            <input type="checkbox" name="daily_digest" defaultChecked={mine.dailyDigest} className="h-5 w-5" data-testid="pref-digest" />
            {t('Quiero un resumen diario', 'I want a daily summary')}
          </label>
        </Card>
        <div className="mt-6 flex justify-end"><Submit testId="prefs-save">{t('Guardar preferencias', 'Save preferences')}</Submit></div>
      </ActionForm>
    </div>
  )
}
