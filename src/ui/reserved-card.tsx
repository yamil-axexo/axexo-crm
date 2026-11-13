import type { Ctx } from '@/server/context'
import { Card, CardTitle, Field } from '@/ui/kit'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { reservedFields, type RecordObject } from '@/domain/plataforma/sensitive'
import * as A from '@/app/(app)/plataforma-actions'

const row = 'flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'

/** SEG-02: tarjeta de datos reservados de un negocio o un contacto. No aparece si el rol de la persona no ve ninguno. */
export async function ReservedCard({ ctx, object, id, title, tz }: { ctx: Ctx; object: RecordObject; id: string; title?: string; tz: string }) {
  const { t, locale } = ctx
  const fields = await reservedFields(ctx, object, id)
  if (fields.length === 0) return null
  const canReveal = !ctx.viewAs
  return (
    <Card data-testid={`reserved-${object}`}>
      <CardTitle
        title={title ?? t('Datos reservados', 'Restricted data')}
        hint={t('Se guardan tapados. Verlos pide un motivo y queda registrado quién, cuándo y para qué. Aquí no van tarjetas, cuentas bancarias ni identificaciones.', 'They are stored masked. Seeing one asks for a reason, and who, when and why is logged. No cards, bank accounts or IDs go here.')}
      />
      <ul>
        {fields.map((f) => (
          <li key={f.field_key} className={row} data-testid={`reserved-${f.field_key}`}>
            <div className="min-w-0 flex-1 basis-[220px]">
              <p className="text-[15px] font-semibold text-strong">{t(f.label_es, f.label_en)}</p>
              <p className={small} data-testid="reserved-state">{f.has_value ? `•••••••• · ${t('guardado el', 'saved on')} ${day(f.updated_at, locale, tz)}` : t('Sin dato', 'No value')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {f.has_value && f.can_view && canReveal && (
                <Dialog trigger={t('Ver', 'Show')} title={t(`Ver ${f.label_es}`, `Show ${f.label_en}`)} variant="quiet" size="sm" testId="reserved-reveal-open">
                  <RevealOnce action={A.revealReservedAction} label={t('Queda registrado que lo viste. No lo copies a notas ni a mensajes.', 'It is logged that you saw it. Do not copy it into notes or messages.')} copyLabel={t('Copiar', 'Copy')}>
                    <input type="hidden" name="object" value={object} />
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="key" value={f.field_key} />
                    <Field label={t('Para qué necesitas verlo', 'Why you need to see it')} hint={t('10 caracteres o más. Queda en la bitácora.', '10 characters or more. It is logged.')}>
                      <input name="reason" className="input" required minLength={10} maxLength={300} data-testid="reserved-reason" />
                    </Field>
                    <div className="mt-4"><Submit testId="reserved-reveal">{t('Ver el dato', 'Show the value')}</Submit></div>
                  </RevealOnce>
                </Dialog>
              )}
              {f.can_edit && (
                <Dialog trigger={f.has_value ? t('Cambiar', 'Change') : t('Cargar', 'Add')} title={t(f.label_es, f.label_en)} variant="quiet" size="sm" testId="reserved-edit-open">
                  <ActionForm action={A.setReservedAction} onOk="close">
                    <input type="hidden" name="object" value={object} />
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="key" value={f.field_key} />
                    <Field label={t('Dato', 'Value')} hint={t('Hasta 1,500 caracteres. La bitácora guarda que cambió, no el valor.', 'Up to 1,500 characters. The log keeps that it changed, not the value.')}>
                      <textarea name="value" className="input min-h-24" required maxLength={1500} data-testid="reserved-value" />
                    </Field>
                    <div className="mt-4"><Submit testId="reserved-save">{t('Guardar', 'Save')}</Submit></div>
                  </ActionForm>
                </Dialog>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
