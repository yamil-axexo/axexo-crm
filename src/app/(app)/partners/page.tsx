import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { partnerExtras, partnerPortal, partnersAdmin, partnersCampo2 } from '@/dal/partners'
import { crossmatchWhere } from '@/domain/campo-canal/canal2'
import { StatementList } from './statements'
import { boardConfig, partnerBoard } from '@/dal/role-boards'
import { metricOwners } from '@/dal/reportes'
import { RoleBoard } from '@/ui/role-board'
import { LIFECYCLE } from '@/lib/labels'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader, Table } from '@/ui/kit'
import { ActionForm, RevealOnce, Submit } from '@/ui/client'
import { day, num } from '@/lib/format'
import { flat } from '@/server/params'
import * as A from './actions'

export const dynamic = 'force-dynamic'

const small = 'text-[13px] text-muted'
type Pair = [string, string]
const KIND: Record<string, Pair> = { organization: ['Organización', 'Organization'], distributor: ['Distribuidor', 'Distributor'], chain: ['Cadena', 'Chain'], store: ['Punto de venta', 'Store'] }
const MATCH: Record<string, Pair> = { phone: ['Teléfono', 'Phone'], alias: ['ID de otro sistema', 'ID from another system'], tax_id: ['Identificador fiscal', 'Tax ID'] }

/**
 * CANAL-01 y CANAL-06. Para una persona de partner es su portal: su subárbol con el estado del alta de cada punto, su nivel y su
 * material. Para quien maneja partners: registro, niveles con criterios publicados, material, accesos, tokens y cruce de bases.
 */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const lc = (k: string) => (LIFECYCLE[k] ? t(...LIFECYCLE[k].label) : k)

  if (ctx.can('partner.portal') && !ctx.can('partner.manage')) {
    const [p, x] = await Promise.all([partnerPortal(ctx), partnerExtras(ctx)])
    const canClaim = ctx.can('claim.partner_register') && p.roots.length > 0
    const [board, boardValues, owners] = await Promise.all([boardConfig(ctx, 'partner'), partnerBoard(ctx, p.roots.map((r) => r.id)), metricOwners(ctx)])
    return (
      <div className="mx-auto max-w-[960px] space-y-8">
        <PageHeader eyebrow={t('Portal de partners', 'Partner portal')} title={p.roots.map((r) => r.name).join(', ') || t('Tu red', 'Your network')}
          desc={t('Lo que ves es tu red: tu nodo y lo que cuelga de él, con el estado del alta de cada punto. Aquí también registras tiendas nuevas y ves tu estado de comisión.', 'What you see is your network: your node and everything under it, with each store’s onboarding status. Here you also register new stores and see your commission statement.')} />
        {/* REP-01 (reportes2): de 5 a 7 cifras del partner, cada una con su definición y su dueño (crm.role_boards). Reemplaza las tres tarjetas de conteo. */}
        <RoleBoard t={t} locale={locale} items={board} values={boardValues} owners={owners} testId="partner-board" />
        <Card pad={false} data-testid="portal-tree">
          <div className="p-7 pb-0"><CardTitle title={t('Tu red', 'Your network')} /></div>
          {p.nodes.length === 0 ? (
            <div className="p-7"><Empty title={t('Todavía no hay puntos en tu red', 'No stores in your network yet')} /></div>
          ) : (
            <Table label={t('Tu red', 'Your network')} testId="portal-table" head={<><th>{t('Nombre', 'Name')}</th><th>{t('Tipo', 'Type')}</th><th>{t('Estado del alta', 'Onboarding status')}</th><th>{t('Etapa', 'Stage')}</th></>}>
              {p.nodes.map((n) => (
                <tr key={n.id} data-testid="portal-row">
                  <td style={{ paddingLeft: `${16 + Math.min(n.depth, 4) * 18}px` }} className="font-medium text-strong">{n.name}</td>
                  <td>{t(...(KIND[n.kind] ?? [n.kind, n.kind]))}</td>
                  <td><Badge tone={LIFECYCLE[n.lifecycle]?.tone ?? 'neutral'}>{lc(n.lifecycle)}</Badge></td>
                  <td>{(locale === 'en' ? n.stage_en : n.stage) ?? t('Sin negocio', 'No deal')}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card data-testid="portal-claims">
          <CardTitle title={t('Tus registros de tiendas', 'Your store registrations')} hint={t('Registra la tienda que estás trabajando: queda protegida para tu canal mientras dure la ventana. La venta directa no ve tus registros.', 'Register the store you are working on: it stays protected for your channel while the window lasts. Direct sales does not see your registrations.')} />
          {x.rules.map((r) => (
            <div key={r.market_code} className="mb-4 rounded-[14px] bg-surface-2 px-4 py-3 text-[13.5px] text-strong" data-testid="portal-rules">
              <p className="font-semibold">{t('Reglas', 'Rules')}{x.rules.length > 1 ? ` · ${r.market_code}` : ''}</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>{t(`Una tienda queda protegida ${r.window_days} días desde que la registras.`, `A store stays protected for ${r.window_days} days from when you register it.`)}</li>
                <li>{t(`Se puede extender ${r.max_extensions} veces, ${r.extension_days} días cada vez, con evidencia de actividad (visita, propuesta, llamada).`, `It can be extended ${r.max_extensions} times, ${r.extension_days} days each, with evidence of activity (visit, proposal, call).`)}</li>
                <li>{t('Una tienda que ya es cliente o que ya tiene registro vigente de otro canal no se registra; te decimos hasta cuándo, no de quién.', 'A store that is already a customer or already registered by another channel is not registered; we tell you until when, not by whom.')}</li>
                {r.policy_es && <li>{t(`Disputas y reversos: ${r.policy_es}`, `Disputes and reversals: ${r.policy_en}`)}</li>}
              </ul>
            </div>
          ))}
          {canClaim && (
            <ActionForm action={A.partnerClaimAction} className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end" testId="portal-claim-form">
              {p.roots.length > 1
                ? <Field label={t('A nombre de', 'On behalf of')}><select name="root" className="input" required>{p.roots.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                : <input type="hidden" name="root" value={p.roots[0]!.id} />}
              <Field label={t('Tienda', 'Store')}><input name="storeName" className="input" required minLength={2} maxLength={160} data-testid="portal-claim-store" /></Field>
              <Field label={t('Ciudad', 'City')}><input name="city" className="input" required minLength={2} maxLength={80} data-testid="portal-claim-city" /></Field>
              <Submit testId="portal-claim-save">{t('Registrar', 'Register')}</Submit>
            </ActionForm>
          )}
          {x.claims.length === 0 ? <Empty title={t('Sin registros todavía', 'No registrations yet')} /> : (
            <ul>{x.claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-3 text-[14px] first:border-t-0" data-testid="portal-claim-row" data-status={c.status}>
                <span className="font-medium text-strong">{c.store_name}</span>
                <span className="text-[13px] text-muted">{c.status === 'active' ? t(`Protegida hasta el ${day(c.expires_at, locale)}`, `Protected until ${day(c.expires_at, locale)}`) : c.status === 'rejected' ? t(`No se registró: ${c.rejection_reason ?? ''}`, `Not registered: ${c.rejection_reason === 'La tienda ya es cliente' ? 'the store is already a customer' : c.rejection_reason === 'Ya tiene registro vigente de otro canal' ? 'it is already registered by another channel' : (c.rejection_reason ?? '')}`) : c.status === 'expired' ? t('Venció', 'Expired') : t('Liberada', 'Released')}</span>
              </li>
            ))}</ul>
          )}
        </Card>
        <Card data-testid="portal-statements">
          <CardTitle title={t('Tu estado de comisión', 'Your commission statement')} hint={t('Conteos de tu red, sin montos. El estimado se vuelve publicado cuando axexo lo publica con las reglas escritas.', 'Counts for your network, no amounts. The estimate becomes published when axexo publishes it under the written rules.')} />
          <StatementList t={t} locale={locale} rows={x.statements} testId="portal-statement-list" />
        </Card>
        <Card data-testid="portal-materials">
          <CardTitle title={t('Material de tu nivel', 'Material for your tier')} hint={t('Los cursos viven en Kore Academy.', 'The courses live in Kore Academy.')} />
          {p.materials.length === 0 ? <Empty title={t('Sin material asignado todavía', 'No material assigned yet')} /> : (
            <ul className="space-y-2">{p.materials.map((m) => <li key={m.url}><a href={m.url} target="_blank" rel="noreferrer noopener" className="text-blue-text underline">{t(m.title_es, m.title_en)}</a></li>)}</ul>
          )}
          {x.progress.length > 0 && (
            <ul className="mt-4 border-t border-line pt-3" data-testid="portal-progress">{x.progress.map((g, i) => (
              <li key={i} className="py-1.5 text-[13.5px]"><span className="font-medium text-strong">{t(g.material_es, g.material_en)}</span> · {g.learner_ref} · <span className="num">{g.progress_pct}%</span>{g.completed_on ? t(` · terminado el ${day(g.completed_on, locale)}`, ` · finished on ${day(g.completed_on, locale)}`) : ''}</li>
            ))}</ul>
          )}
        </Card>
      </div>
    )
  }

  const markets = ctx.markets.filter((m) => ctx.can('partner.manage', m.code))
  if (markets.length === 0) notFound()
  const q = flat(await searchParams).m
  const market = markets.find((m) => m.code === q)?.code ?? markets[0]!.code
  const [d, c2, where] = await Promise.all([partnersAdmin(ctx, market), partnersCampo2(ctx, market), crossmatchWhere(market)])
  const tierName = (code: string | null) => {
    const x = d.tiers.find((tt) => tt.code === code)
    return x ? t(x.name_es, x.name_en) : t('Sin nivel', 'No tier')
  }
  return (
    <div className="mx-auto max-w-[1040px] space-y-8">
      <PageHeader
        title={t('Partners', 'Partners')}
        desc={t('ISOs, agentes y distribuidores: su nivel con criterios publicados, su material, quién entra a su portal y qué de su red ya existe en nuestra cartera.', 'ISOs, agents and distributors: their tier with published criteria, their material, who signs in to their portal and what of their network already exists in our portfolio.')}
        actions={<>
          {markets.length > 1 && markets.map((m) => <LinkButton key={m.code} href={`/partners?m=${m.code}`} variant={m.code === market ? 'primary' : 'ghost'} size="sm">{m.name}</LinkButton>)}
          {ctx.can('network.load', market) && <LinkButton href="/partners/redes" testId="nets-open">{t('Redes adquiridas', 'Acquired networks')}</LinkButton>}
        </>}
      />

      <Card data-testid="partners-list">
        <CardTitle title={t('Partners registrados', 'Registered partners')} hint={t('El nivel se recalcula cada día con los criterios de abajo. Nadie lo negocia.', 'The tier is recalculated daily with the criteria below. Nobody negotiates it.')}
          right={<ActionForm action={A.recalcTiersAction}><input type="hidden" name="market" value={market} /><Submit size="sm" variant="ghost" testId="tiers-recalc">{t('Recalcular ahora', 'Recalculate now')}</Submit></ActionForm>} />
        {d.profiles.length === 0 ? <Empty title={t('Sin partners registrados', 'No registered partners')} hint={t('Registra la cuenta del ISO o distribuidor: su nivel y su cruce de bases salen de su subárbol.', 'Register the ISO or distributor account: its tier and cross-match come from its subtree.')} /> : (
          <Table label={t('Partners', 'Partners')} testId="partners-table" head={<><th>{t('Partner', 'Partner')}</th><th>{t('Nivel', 'Tier')}</th><th>{t('Activos', 'Active')}</th><th>{t('Calidad de altas', 'Onboarding quality')}</th><th>{t('Cumplimiento', 'Compliance')}</th><th>{t('Ya en la cartera', 'Already ours')}</th></>}>
            {d.profiles.map((p) => {
              const m = p.metrics as { active?: number; quality_pct?: number | null; compliance_pct?: number | null }
              const pct = (v: number | null | undefined) => (v === null || v === undefined ? t('Sin datos', 'No data') : `${num(v, locale)}%`)
              return (
                <tr key={p.account_id} data-testid="partner-row">
                  <td><Link href={`/comercios/${p.account_id}`} className="font-medium text-blue-text hover:underline">{p.name}</Link><p className={small}>{t('desde', 'since')} {day(p.since, locale)}</p></td>
                  <td>{p.tier_period ? <Badge tone={p.tier_code ? 'accent' : 'neutral'}>{tierName(p.tier_code)}</Badge> : <span className={small}>{t('Por calcular', 'Not calculated yet')}</span>}</td>
                  <td className="num">{m.active === undefined ? t('Sin datos', 'No data') : num(m.active, locale)}</td>
                  <td className="num">{pct(m.quality_pct)}</td>
                  <td className="num">{pct(m.compliance_pct)}</td>
                  <td className="num">{num(p.overlaps, locale)}</td>
                </tr>
              )
            })}
          </Table>
        )}
        <ActionForm action={A.registerPartnerAction} className="mt-6 flex flex-wrap items-end gap-3 border-t border-line pt-6" testId="partner-register">
          <Field label={t('Cuenta (distribuidor, cadena u organización)', 'Account (distributor, chain or organization)')}>
            <select name="account_id" className="input" required defaultValue="" data-testid="partner-register-account">
              <option value="" disabled>{t('Elige la cuenta', 'Choose the account')}</option>
              {d.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Submit testId="partner-register-save">{t('Registrar como partner', 'Register as partner')}</Submit>
        </ActionForm>
      </Card>

      <Card data-testid="tiers-card">
        <CardTitle title={t('Niveles y criterios publicados', 'Tiers and published criteria')} hint={t('Un partner queda en el nivel más alto cuyos tres mínimos cumple: puntos activos, calidad de altas (de lo dado de alta en 90 días, qué parte ya está activa) y cumplimiento (puntos sin avisos abiertos).', 'A partner lands on the highest tier whose three minimums it meets: active stores, onboarding quality (of what was onboarded in 90 days, how much is already active) and compliance (stores with no open alerts).')} />
        {d.tiers.length === 0 ? <Empty title={t('Sin niveles todavía', 'No tiers yet')} /> : (
          <Table label={t('Niveles', 'Tiers')} testId="tiers-table" head={<><th>{t('Nivel', 'Tier')}</th><th>{t('Puntos activos', 'Active stores')}</th><th>{t('Calidad', 'Quality')}</th><th>{t('Cumplimiento', 'Compliance')}</th><th>{t('Material', 'Material')}</th></>}>
            {d.tiers.map((x) => (
              <tr key={x.code} data-testid="tier-row">
                <td className="font-medium text-strong">{t(x.name_es, x.name_en)}</td>
                <td className="num">{num(x.min_active, locale)}+</td><td className="num">{num(x.min_quality_pct, locale)}%+</td><td className="num">{num(x.min_compliance_pct, locale)}%+</td>
                <td>{d.materials.filter((m) => m.tier_code === x.code).map((m) => <a key={m.id} href={m.url} target="_blank" rel="noreferrer noopener" className="block text-blue-text underline">{t(m.title_es, m.title_en)}</a>)}</td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-6 grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
          <ActionForm action={A.saveTierAction} testId="tier-form">
            <input type="hidden" name="market" value={market} />
            <p className="mb-3 text-[14px] font-semibold text-strong">{t('Nivel nuevo o cambio de criterios', 'New tier or criteria change')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Clave', 'Key')}><input name="code" className="input" required pattern="[a-z][a-z0-9_]{1,30}" data-testid="tier-code" /></Field>
              <Field label={t('Orden (1 es el más bajo)', 'Order (1 is the lowest)')}><input name="rank" type="number" min={1} max={10} className="input" required data-testid="tier-rank" /></Field>
              <Field label={t('Nombre en español', 'Name in Spanish')}><input name="name_es" className="input" required maxLength={40} data-testid="tier-name-es" /></Field>
              <Field label={t('Nombre en inglés', 'Name in English')}><input name="name_en" className="input" required maxLength={40} data-testid="tier-name-en" /></Field>
              <Field label={t('Puntos activos mínimos', 'Minimum active stores')}><input name="min_active" type="number" min={0} className="input" required defaultValue={0} data-testid="tier-min-active" /></Field>
              <Field label={t('Calidad mínima (%)', 'Minimum quality (%)')}><input name="min_quality" type="number" min={0} max={100} className="input" required defaultValue={0} /></Field>
              <Field label={t('Cumplimiento mínimo (%)', 'Minimum compliance (%)')}><input name="min_compliance" type="number" min={0} max={100} className="input" required defaultValue={0} /></Field>
            </div>
            <div className="mt-4"><Submit size="sm" testId="tier-save">{t('Guardar nivel', 'Save tier')}</Submit></div>
          </ActionForm>
          <ActionForm action={A.addMaterialAction} onOk="reset" testId="material-form">
            <input type="hidden" name="market" value={market} />
            <p className="mb-3 text-[14px] font-semibold text-strong">{t('Material de habilitación', 'Enablement material')}</p>
            <div className="grid gap-3">
              <Field label={t('Nivel', 'Tier')}>
                <select name="tier" className="input" required defaultValue="">
                  <option value="" disabled>{t('Elige el nivel', 'Choose the tier')}</option>
                  {d.tiers.map((x) => <option key={x.code} value={x.code}>{t(x.name_es, x.name_en)}</option>)}
                </select>
              </Field>
              <Field label={t('Título en español', 'Title in Spanish')}><input name="title_es" className="input" required maxLength={120} /></Field>
              <Field label={t('Título en inglés', 'Title in English')}><input name="title_en" className="input" required maxLength={120} /></Field>
              <Field label={t('Enlace al curso de Kore Academy', 'Kore Academy course link')}><input name="url" type="url" className="input" required placeholder="https://" /></Field>
            </div>
            <div className="mt-4"><Submit size="sm" variant="ghost">{t('Agregar material', 'Add material')}</Submit></div>
          </ActionForm>
        </div>
      </Card>

      <Card data-testid="partner-access">
        <CardTitle title={t('Acceso al portal y tokens de lectura', 'Portal access and read tokens')} hint={t('Un usuario de partner ve su nodo y lo que cuelga de él, en solo lectura; la base lo garantiza. Las personas de afuera todavía no pueden entrar: su entrada está apagada.', 'A partner user sees their node and everything under it, read-only; the database enforces it. Outside people cannot sign in yet: their sign-in is off.')} />
        {d.partnerUsers.length === 0 ? <Empty title={t('Nadie tiene acceso de partner', 'Nobody has partner access')} /> : (
          <ul className="mb-4" data-testid="partner-users">
            {d.partnerUsers.map((u) => <li key={u.user_id} className="border-t border-line py-3 first:border-t-0"><p className="font-medium text-strong">{u.full_name}</p><p className={small}>{u.email} · {u.scope}</p></li>)}
          </ul>
        )}
        <div className="grid gap-6 border-t border-line pt-6 lg:grid-cols-2">
          {ctx.can('access.manage') && (
            <div className="space-y-4">
              <ActionForm action={A.grantPartnerAction} testId="partner-grant">
                <p className="mb-3 text-[14px] font-semibold text-strong">{t('Dar acceso de partner', 'Give partner access')}</p>
                <div className="grid gap-3">
                  <Field label={t('Persona', 'Person')}><select name="user_id" className="input" required defaultValue=""><option value="" disabled>{t('Elige a quién', 'Choose who')}</option>{d.freeUsers.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}</select></Field>
                  <Field label={t('Nodo que ve', 'Node they see')}><select name="account_id" className="input" required defaultValue=""><option value="" disabled>{t('Elige la cuenta', 'Choose the account')}</option>{d.profiles.map((p) => <option key={p.account_id} value={p.account_id}>{p.name}</option>)}</select></Field>
                </div>
                <div className="mt-4"><Submit size="sm">{t('Dar acceso', 'Give access')}</Submit></div>
              </ActionForm>
              <ActionForm action={A.invitePartnerAction} testId="partner-invite">
                <Field label={t('Invitar a alguien de afuera a un portal', 'Invite an outside person to a portal')}><select name="account_id" className="input" required defaultValue=""><option value="" disabled>{t('Elige la cuenta', 'Choose the account')}</option>{d.profiles.map((p) => <option key={p.account_id} value={p.account_id}>{p.name}</option>)}</select></Field>
                <div className="mt-4"><Submit size="sm" variant="ghost" testId="partner-invite-save">{t('Invitar', 'Invite')}</Submit></div>
              </ActionForm>
            </div>
          )}
          <div>
            <RevealOnce action={A.createTokenAction} label={t('Cópialo ahora: no se vuelve a mostrar.', 'Copy it now: it will not be shown again.')} copyLabel={t('Copiar', 'Copy')}>
              <p className="mb-3 text-[14px] font-semibold text-strong">{t('Token de lectura para la API', 'Read token for the API')}</p>
              <p className={`${small} mb-3`}>{t('GET /api/partners/v1/accounts con "Authorization: Bearer". Lee lo mismo que ve esa persona de partner.', 'GET /api/partners/v1/accounts with "Authorization: Bearer". It reads the same as that partner user sees.')}</p>
              <div className="grid gap-3">
                <Field label={t('Persona de partner', 'Partner user')}><select name="user_id" className="input" required defaultValue="" data-testid="token-user"><option value="" disabled>{t('Elige a quién', 'Choose who')}</option>{d.partnerUsers.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name} · {u.scope}</option>)}</select></Field>
                <Field label={t('Nombre del token', 'Token name')}><input name="label" className="input" required maxLength={80} data-testid="token-label" /></Field>
              </div>
              <div className="mt-4"><Submit size="sm" testId="token-create">{t('Crear token', 'Create token')}</Submit></div>
            </RevealOnce>
            {d.tokens.length > 0 && (
              <ul className="mt-5" data-testid="token-list">
                {d.tokens.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3">
                    <div><p className="font-medium text-strong">{k.label}</p><p className={small}>{k.user} · {k.scope} · {k.last_used_at ? t(`último uso ${day(k.last_used_at, locale)}`, `last used ${day(k.last_used_at, locale)}`) : t('sin uso', 'never used')}</p></div>
                    {k.revoked_at ? <Badge tone="neutral">{t('Revocado', 'Revoked')}</Badge> : (
                      <ActionForm action={A.revokeTokenAction}><input type="hidden" name="id" value={k.id} /><Submit size="sm" variant="quiet" testId="token-revoke">{t('Revocar', 'Revoke')}</Submit></ActionForm>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {ctx.can('statement.manage', market) && (
        <Card data-testid="statements-admin">
          <CardTitle title={t('Estado de comisión por persona y aliado', 'Commission statement per person and partner')} hint={t('Conteos del mes, sin montos. Se publica solo con las reglas escritas y aprobadas; lo publicado ya no cambia.', 'Counts for the month, no amounts. It is published only under the written, approved rules; what is published no longer changes.')}
            right={<ActionForm action={A.estimateStatementsAction}><input type="hidden" name="market" value={market} /><Submit size="sm" variant="ghost" testId="statements-estimate">{t('Calcular ahora', 'Calculate now')}</Submit></ActionForm>} />
          <StatementList t={t} locale={locale} rows={c2.statements} testId="statements-admin-list" />
          {c2.statements.some((s) => s.status === 'estimate') && (
            <ActionForm action={A.publishStatementAction} className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 md:grid-cols-3 md:items-end" testId="statement-publish">
              <Field label={t('Estado', 'Statement')}><select name="id" className="input" required defaultValue="">{[<option key="" value="" disabled>{t('Elige', 'Choose')}</option>, ...c2.statements.filter((s) => s.status === 'estimate').map((s) => <option key={s.id} value={s.id}>{s.month} · {s.party_label}</option>)]}</select></Field>
              <Field label={t('Reglas escritas (enlace o documento aprobado)', 'Written rules (link or approved document)')}><input name="rules" className="input" required minLength={3} maxLength={200} /></Field>
              <Submit variant="ghost" testId="statement-publish-btn">{t('Publicar', 'Publish')}</Submit>
            </ActionForm>
          )}
        </Card>
      )}

      {ctx.can('enablement.record', market) && (
        <Card data-testid="progress-admin">
          <CardTitle title={t('Avance de capacitación de aliados', 'Partner training progress')} hint={t('Llega de Kore Academy cuando la conexión se encienda; mientras tanto se anota aquí.', 'It arrives from Kore Academy once the connection is on; meanwhile it is recorded here.')} />
          {c2.progress.length === 0 ? <Empty title={t('Sin avance registrado', 'No progress recorded')} /> : (
            <ul>{c2.progress.map((g, i) => <li key={i} className="border-t border-line py-2 text-[13.5px] first:border-t-0" data-testid="progress-row">{g.partner} · {t(g.material_es, g.material_en)} · {g.learner_ref} · <span className="num">{g.progress_pct}%</span> · {g.source === 'kore_academy' ? 'Kore Academy' : t('a mano', 'by hand')}</li>)}</ul>
          )}
          {d.profiles.length > 0 && c2.materials.length > 0 && (
            <ActionForm action={A.enablementProgressAction} className="mt-4 grid grid-cols-1 gap-3 border-t border-line pt-4 md:grid-cols-5 md:items-end" testId="progress-form">
              <Field label={t('Aliado', 'Partner')}><select name="partner" className="input" required>{d.profiles.map((p) => <option key={p.account_id} value={p.account_id}>{p.name}</option>)}</select></Field>
              <Field label={t('Material', 'Material')}><select name="material" className="input" required>{c2.materials.map((m) => <option key={m.id} value={m.id}>{t(m.title_es, m.title_en)}</option>)}</select></Field>
              <Field label={t('Quién lo toma', 'Who takes it')}><input name="learner" className="input" required minLength={2} maxLength={80} /></Field>
              <Field label={t('Avance (%)', 'Progress (%)')}><input name="pct" type="number" min={0} max={100} className="input" required /></Field>
              <Submit variant="ghost">{t('Anotar', 'Record')}</Submit>
            </ActionForm>
          )}
        </Card>
      )}

      {ctx.can('partner.crossmatch', market) && (
        <Card data-testid="overlaps-card">
          <CardTitle title={t('Cruce de bases', 'Base cross-match')} hint={t('Puntos de la red de un partner que ya están en nuestra cartera, por teléfono, ID de otro sistema o identificador fiscal. Solo lo ve quien maneja partners.', 'Stores in a partner’s network that are already in our portfolio, by phone, ID from another system or tax ID. Only whoever manages partners sees it.')}
            right={<ActionForm action={A.crossMatchAction}><input type="hidden" name="market" value={market} /><Submit size="sm" variant="ghost" testId="crossmatch-run">{t('Cruzar ahora', 'Match now')}</Submit></ActionForm>} />
          <p className={`${small} mb-3`} data-testid="crossmatch-where">{where === 'lakehouse' ? t('El cruce corre en el lakehouse de Data y Reportería.', 'The match runs in the Data and Reporting lakehouse.') : t('Hoy el cruce corre dentro de CONTIGO, con índice ciego y acceso restringido. Pasarlo al lakehouse espera a Data y Reportería (ver Estado de CONTIGO).', 'Today the match runs inside CONTIGO, with a blind index and restricted access. Moving it to the lakehouse waits on Data and Reporting (see CONTIGO status).')}</p>
          {d.overlaps.length === 0 ? <Empty title={t('Sin coincidencias', 'No matches')} hint={t('El cruce corre cada día y también a mano.', 'The match runs daily and by hand too.')} /> : (
            <Table label={t('Coincidencias', 'Matches')} testId="overlaps-table" head={<><th>{t('Partner', 'Partner')}</th><th>{t('Su punto', 'Their store')}</th><th>{t('Nuestro comercio', 'Our merchant')}</th><th>{t('Por', 'By')}</th></>}>
              {d.overlaps.map((o, i) => (
                <tr key={i} data-testid="overlap-row"><td>{o.partner}</td><td>{o.node}</td><td><Link href={`/comercios/${o.own_id}`} className="text-blue-text hover:underline">{o.own}</Link>{o.owner && <p className={small}>{o.owner}</p>}</td><td>{t(...(MATCH[o.match_key] ?? [o.match_key, o.match_key]))}</td></tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
