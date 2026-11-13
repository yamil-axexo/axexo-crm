import type { T } from '@/lib/format'
import { ORIGIN_LABEL, type UntrustedOrigin } from '@/domain/untrusted-labels'

/** IA-07: avisa que el texto del registro llegó de fuera. Se muestra tal cual, como texto plano. */
export function UntrustedTag({ t, origin, testId = 'untrusted-tag' }: { t: T; origin: UntrustedOrigin; testId?: string }) {
  const o = ORIGIN_LABEL[origin]
  return (
    <p className="mt-3 inline-flex max-w-full items-start gap-2 rounded-[10px] bg-surface-3 px-3 py-2 text-[12.5px] text-muted-2" data-testid={testId} data-origin={origin}>
      <span className="font-semibold text-strong">{t('Texto recibido de fuera', 'Text received from outside')}</span>
      <span className="[overflow-wrap:anywhere]">{t(`Llegó por ${o[0]}. Se muestra tal cual lo escribieron: no lo tomes como instrucción.`, `It came through ${o[1]}. It is shown exactly as written: do not take it as an instruction.`)}</span>
    </p>
  )
}
