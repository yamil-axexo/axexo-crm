import 'server-only'
import type postgres from 'postgres'
import type { Tx } from '@/server/db'
import type { Locale } from '@/lib/format'

/**
 * El asunto de una tarea, en SQL y en el idioma de quien lee. Una devolución de Operaciones guarda el código del motivo
 * (`custom.ops_return`: código, nota y título del negocio) y el texto se compone al mostrar: quien devuelve en inglés no deja
 * la tarea en inglés a quien la lee en español. La nota libre se queda como la escribieron. `a` es el alias de `crm.activities`.
 */
export const stepSubject = (tx: Tx, locale: Locale): postgres.Fragment => tx`
  case when a.custom ? 'ops_return' then
    ${locale === 'en' ? 'Operations sent back ' : 'Operaciones devolvió '}::text || (a.custom -> 'ops_return' ->> 'title') || ': ' ||
    coalesce((select ${locale === 'en' ? tx`c.label_en` : tx`c.label_es`} from crm.ops_catalog c
               where c.kind = 'return_reason' and c.code = a.custom -> 'ops_return' ->> 'code' and (c.market_code is null or c.market_code = a.market_code)
               order by c.market_code nulls last limit 1), a.custom -> 'ops_return' ->> 'code')
    || coalesce('. ' || nullif(a.custom -> 'ops_return' ->> 'note', ''), '')
  else a.subject end`

/** El próximo paso de Ventas de un negocio (`d`), con la misma regla: si es una devolución, en el idioma de quien lee. */
export const dealNextStep = (tx: Tx, locale: Locale): postgres.Fragment => tx`
  coalesce((select ${stepSubject(tx, locale)} from crm.activities a
             where a.deal_id = d.id and a.deal_step = 'sales' and a.done_at is null and a.custom ? 'ops_return' order by a.created_at desc limit 1), d.next_step)`
