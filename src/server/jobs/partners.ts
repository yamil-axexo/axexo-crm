import type { Job } from './types'
import { contractsDaily, crossMatch, recalcTiers } from '@/domain/partners'
import { notify } from '@/domain/notify'

/**
 * Tareas programadas del paquete partners-contratos. Las tres son seguras de correr dos veces: los estados del contrato solo
 * avanzan, el aviso de renovación se marca al darse, y niveles y cruce de bases se vuelven a calcular completos.
 */
export const partnersJobs: Job[] = [
  {
    key: 'partners.contracts',
    everyMinutes: 360,
    description: {
      es: 'Pasa a vigente el contrato firmado que ya empezó, a vencido el que ya terminó, y avisa a quien lleva la cuenta cuando llega el plazo de renovación.',
      en: 'Moves a signed contract that has started to active, an ended one to expired, and notifies the account owner when the renewal notice period arrives.',
    },
    run: async (tx) => {
      const sys = (await tx<{ id: string }[]>`select app.system_user_id() as id`)[0]!.id
      const done = await contractsDaily(tx, async (t, c) => {
        await notify(t, { user: { id: sys } }, {
          to: c.owner_id, kind: 'lifecycle', market: c.market_code, accountId: c.account_id, link: `/comercios/${c.account_id}/contratos`, needsAction: true,
          title: [`Contrato por renovar: ${c.name}`, `Contract due for renewal: ${c.name}`],
          body: [`El contrato vence el ${c.ends_on}. Revisa los términos y prepara la renovación.`, `The contract ends on ${c.ends_on}. Review the terms and prepare the renewal.`],
        })
      })
      return { done }
    },
  },
  {
    key: 'partners.tiers',
    everyMinutes: 1440,
    description: {
      es: 'Recalcula el nivel de cada partner del período con los criterios publicados: PDV activos, calidad de altas y cumplimiento.',
      en: 'Recalculates each partner’s tier for the period with the published criteria: active stores, onboarding quality and compliance.',
    },
    run: async (tx) => ({ done: await recalcTiers(tx) }),
  },
  {
    key: 'partners.crossmatch',
    everyMinutes: 1440,
    description: {
      es: 'Cruza los PDV de cada partner contra la cartera propia por teléfono, ID de otro sistema e identificador fiscal. El resultado lo ve solo quien maneja los partners.',
      en: 'Matches each partner’s stores against the own portfolio by phone, ID from another system and tax ID. Only whoever manages partners sees the result.',
    },
    run: async (tx) => ({ done: await crossMatch(tx) }),
  },
]
