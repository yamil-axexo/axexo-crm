import { notFound } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { getAccountSecurity } from '@/dal/security'
import { CHANNELS, CONSENT_CATEGORIES, TEAM_FUNCTIONS } from '@/domain/security'
import { Badge, Card, CardTitle, Empty, Field, LinkButton, PageHeader } from '@/ui/kit'
import { ActionForm, Dialog, RevealOnce, Submit } from '@/ui/client'
import { day } from '@/lib/format'
import { readerTimeZone } from '@/server/timezone'
import { ReservedCard } from '@/ui/reserved-card'
import * as A from '@/app/(app)/admin/seguridad/actions'
import { CHANNEL_LABEL, CONSENT_CATEGORY, CONSENT_SOURCE, TEAM_FUNCTION } from '@/app/(app)/admin/seguridad/labels'

export const dynamic = 'force-dynamic'

const row = 'flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-t border-line py-4 first:border-t-0'
const small = 'text-[13px] text-muted'

/** SEG-01, SEG-02 y SEG-04 en la ficha: quién más trabaja la cuenta, sus datos reservados (tapados) y el consentimiento de sus contactos. */
export default async function AccountTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const d = await getAccountSecurity(ctx, id)
  if (!d) notFound()
  const a = d.account
  const tz = await readerTimeZone(ctx)
  const pair = (map: Record<string, [string, string]>, k: string) => t(map[k]?.[0] ?? k, map[k]?.[1] ?? k)
  const canTeam = a.can_manage && ctx.can('account.team', a.market_code)
  const canConsent = ctx.can('consent.write', a.market_code)
  // Mientras alguien ve como otra persona, los datos reservados no se revelan.
  const canReveal = !ctx.viewAs
  return (
    <div className="mx-auto max-w-[760px] space-y-8">
      <PageHeader
        eyebrow={a.name}
        title={t('Equipo y datos reservados', 'Team and restricted data')}
        desc={t('Quién más trabaja esta cuenta, los datos que solo ven algunos roles y el permiso de sus contactos para escribirles o llamarles. Todo cambio queda en la bitácora.', 'Who else works this account, the data only some roles can see, and whether its contacts agreed to be written to or called. Every change is logged.')}
        actions={<LinkButton href={`/comercios/${id}?tab=datos`} testId="team-back">{t('Volver', 'Back')}</LinkButton>}
      />

      <Card data-testid="account-team-card">
        <CardTitle
          title={t('Equipo de la cuenta', 'Account team')}
          hint={t(`La lleva ${a.owner ?? 'nadie todavía'}. Quien entra al equipo ve la cuenta aunque no sea suya; con permiso de editar, también la cambia.`, `${a.owner ?? 'Nobody yet'} owns it. Whoever joins the team sees the account even if it is not theirs; with edit permission they can change it too.`)}
          right={a.agency ? <Badge tone="neutral">{t(`Reclutada por ${a.agency}`, `Recruited by ${a.agency}`)}</Badge> : undefined}
        />
        {d.team.length === 0 ? (
          <Empty title={t('Solo la trabaja quien la lleva', 'Only its owner works it')} hint={t('Suma a quien apoya esta cuenta: un especialista, alguien de Operaciones o quien la patrocina.', 'Add whoever supports this account: a specialist, someone from Operations or its sponsor.')} />
        ) : (
          <ul data-testid="account-team-list">
            {d.team.map((m) => (
              <li key={m.id} className={row} data-testid="account-team-row">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-strong">{m.full_name}</p>
                  <p className={small}>{pair(TEAM_FUNCTION, m.function)} · {m.access === 'edit' ? t('Ve y edita', 'Sees and edits') : t('Solo ve', 'Sees only')} · {t('desde', 'since')} {day(m.valid_from, locale, tz)}{m.note ? ` · ${m.note}` : ''}</p>
                </div>
                {canTeam && (
                  <ActionForm action={A.removeTeamMemberAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <Submit variant="quiet" size="sm" testId="account-team-remove">{t('Sacar del equipo', 'Remove from team')}</Submit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {canTeam && (
          <ActionForm action={A.addTeamMemberAction} onOk="reset" className="mt-6 border-t border-line pt-6" testId="account-team-form">
            <input type="hidden" name="account_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Persona', 'Person')}>
                <select name="user_id" className="input" required defaultValue="" data-testid="account-team-user">
                  <option value="" disabled>{t('Elige a quién', 'Choose who')}</option>
                  {d.candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </Field>
              <Field label={t('Qué hace en la cuenta', 'What they do on the account')}>
                <select name="function" className="input" defaultValue="support" data-testid="account-team-function">
                  {TEAM_FUNCTIONS.map((k) => <option key={k} value={k}>{pair(TEAM_FUNCTION, k)}</option>)}
                </select>
              </Field>
              <Field label={t('Permiso', 'Permission')}>
                <select name="access" className="input" defaultValue="read" data-testid="account-team-access">
                  <option value="read">{t('Solo ve', 'Sees only')}</option>
                  <option value="edit">{t('Ve y edita', 'Sees and edits')}</option>
                </select>
              </Field>
              <Field label={t('Nota (opcional)', 'Note (optional)')}><input name="note" className="input" maxLength={200} /></Field>
            </div>
            <div className="mt-4"><Submit variant="ghost" testId="account-team-add">{t('Sumar al equipo', 'Add to team')}</Submit></div>
          </ActionForm>
        )}
      </Card>

      <Card data-testid="sensitive-card">
        <CardTitle
          title={t('Datos reservados', 'Restricted data')}
          hint={t('Se guardan tapados. Verlos pide un motivo y queda registrado quién, cuándo y para qué. Aquí no van tarjetas, cuentas bancarias ni identificaciones: CONTIGO no las guarda.', 'They are stored masked. Seeing one asks for a reason, and who, when and why is logged. No cards, bank accounts or IDs go here: CONTIGO does not store them.')}
        />
        {d.sensitive.length === 0 ? (
          <Empty title={t('Tu rol no ve datos reservados de esta cuenta', 'Your role does not see restricted data on this account')} hint={t('Quién ve cada campo lo define Administración, en Seguridad.', 'Administration sets who sees each field, under Security.')} />
        ) : (
          <ul data-testid="sensitive-list">
            {d.sensitive.map((f) => (
              <li key={f.field_key} className={row} data-testid={`sensitive-${f.field_key}`}>
                <div className="min-w-0 flex-1 basis-[220px]">
                  <p className="text-[15px] font-semibold text-strong">{t(f.label_es, f.label_en)}</p>
                  <p className={small} data-testid="sensitive-state">{f.has_value ? `•••••••• · ${t('guardado el', 'saved on')} ${day(f.updated_at, locale, tz)}` : t('Sin dato', 'No value')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {f.has_value && f.can_view && canReveal && (
                    <Dialog trigger={t('Ver', 'Show')} title={t(`Ver ${f.label_es}`, `Show ${f.label_en}`)} variant="quiet" size="sm" testId="sensitive-reveal-open">
                      <RevealOnce action={A.revealAction} label={t('Queda registrado que lo viste. No lo copies a notas ni a mensajes.', 'It is logged that you saw it. Do not copy it into notes or messages.')} copyLabel={t('Copiar', 'Copy')}>
                        <input type="hidden" name="account_id" value={id} />
                        <input type="hidden" name="key" value={f.field_key} />
                        <Field label={t('Para qué necesitas verlo', 'Why you need to see it')} hint={t('10 caracteres o más. Queda en la bitácora.', '10 characters or more. It is logged.')}>
                          <input name="reason" className="input" required minLength={10} maxLength={300} data-testid="sensitive-reason" />
                        </Field>
                        <div className="mt-4"><Submit testId="sensitive-reveal">{t('Ver el dato', 'Show the value')}</Submit></div>
                      </RevealOnce>
                    </Dialog>
                  )}
                  {f.can_edit && (
                    <Dialog trigger={f.has_value ? t('Cambiar', 'Change') : t('Cargar', 'Add')} title={t(f.label_es, f.label_en)} variant="quiet" size="sm" testId="sensitive-edit-open">
                      <ActionForm action={A.setSensitiveAction} onOk="close">
                        <input type="hidden" name="account_id" value={id} />
                        <input type="hidden" name="key" value={f.field_key} />
                        <Field label={t('Dato', 'Value')} hint={t('Hasta 1,500 caracteres. El valor anterior se reemplaza; la bitácora guarda que cambió, no el valor.', 'Up to 1,500 characters. The previous value is replaced; the log keeps that it changed, not the value.')}>
                          <textarea name="value" className="input min-h-24" required maxLength={1500} data-testid="sensitive-value" />
                        </Field>
                        <div className="mt-4"><Submit testId="sensitive-save">{t('Guardar', 'Save')}</Submit></div>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.contacts.map((c) => (
        <ReservedCard key={`reserved-${c.id}`} ctx={ctx} object="contact" id={c.id} tz={tz} title={t(`Datos reservados de ${c.full_name}`, `Restricted data for ${c.full_name}`)} />
      ))}

      <Card data-testid="consent-card">
        <CardTitle
          title={t('Consentimiento y bajas', 'Consent and opt-outs')}
          hint={t('Por contacto, canal y para qué, con la evidencia y la fecha. Una baja manda siempre: esa dirección no recibe nada por ese canal.', 'By contact, channel and purpose, with the evidence and the date. An opt-out always wins: that address gets nothing on that channel.')}
        />
        {d.contacts.length === 0 ? (
          <Empty title={t('Esta cuenta no tiene contactos', 'This account has no contacts')} hint={t('Agrega un contacto en la ficha y vuelve para registrar su consentimiento.', 'Add a contact on the record and come back to record their consent.')} />
        ) : (
          <ul data-testid="consent-contacts">
            {d.contacts.map((c) => {
              const mine = d.consents.filter((x) => x.contact_id === c.id)
              const out = d.optouts.filter((o) => o.address_norm === c.phone || o.address_norm === c.email?.toLowerCase())
              return (
                <li key={c.id} className="border-t border-line py-5 first:border-t-0" data-testid="consent-contact">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[15px] font-semibold text-strong">{c.full_name}</p>
                    {out.length > 0 && <Badge tone="warn">{t(`Baja: ${out.map((o) => pair(CHANNEL_LABEL, o.channel)).join(', ')}`, `Opted out: ${out.map((o) => pair(CHANNEL_LABEL, o.channel)).join(', ')}`)}</Badge>}
                  </div>
                  {mine.length === 0 ? <p className={`${small} mt-1`}>{t('Sin consentimiento registrado.', 'No consent on record.')}</p> : (
                    <ul className="mt-2 space-y-2">
                      {mine.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center justify-between gap-3" data-testid="consent-row">
                          <span className="text-[14px] text-strong">
                            {pair(CHANNEL_LABEL, x.channel)} · {pair(CONSENT_CATEGORY, x.category)} · {pair(CONSENT_SOURCE, x.source)} · {day(x.granted_at, locale, tz)}
                            {x.revoked_at ? <span className="ml-2"><Badge tone="neutral">{t(`Retirado el ${day(x.revoked_at, locale, tz)}`, `Withdrawn on ${day(x.revoked_at, locale, tz)}`)}</Badge></span> : null}
                            {x.evidence ? <span className={`${small} block`}>{x.evidence}</span> : null}
                          </span>
                          {!x.revoked_at && canConsent && (
                            <Dialog trigger={t('Retirar', 'Withdraw')} title={t('Retirar el consentimiento', 'Withdraw the consent')} variant="quiet" size="sm" testId="consent-revoke-open">
                              <ActionForm action={A.revokeConsentAction} onOk="close">
                                <input type="hidden" name="id" value={x.id} />
                                <Field label={t('Qué pidió la persona', 'What the person asked')}><input name="reason" className="input" required minLength={3} maxLength={200} data-testid="consent-revoke-reason" /></Field>
                                <div className="mt-4"><Submit testId="consent-revoke">{t('Retirar', 'Withdraw')}</Submit></div>
                              </ActionForm>
                            </Dialog>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canConsent && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Dialog trigger={t('Registrar consentimiento', 'Record consent')} title={t(`Consentimiento de ${c.full_name}`, `Consent from ${c.full_name}`)} variant="ghost" size="sm" testId="consent-add-open">
                        <ActionForm action={A.recordConsentAction} onOk="close">
                          <input type="hidden" name="contact_id" value={c.id} />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <Field label={t('Canal', 'Channel')}>
                              <select name="channel" className="input" defaultValue="whatsapp" data-testid="consent-channel">{CHANNELS.map((k) => <option key={k} value={k}>{pair(CHANNEL_LABEL, k)}</option>)}</select>
                            </Field>
                            <Field label={t('Para qué', 'Purpose')}>
                              <select name="category" className="input" defaultValue="service" data-testid="consent-category">{CONSENT_CATEGORIES.map((k) => <option key={k} value={k}>{pair(CONSENT_CATEGORY, k)}</option>)}</select>
                            </Field>
                            <Field label={t('Cómo lo dio', 'How it was given')}>
                              <select name="source" className="input" defaultValue="verbal" data-testid="consent-source">{(['verbal', 'written'] as const).map((k) => <option key={k} value={k}>{pair(CONSENT_SOURCE, k)}</option>)}</select>
                            </Field>
                          </div>
                          <Field label={t('Evidencia', 'Evidence')} hint={t('Qué dijo o firmó, y cuándo. Por ejemplo: "Aceptó por teléfono recibir avisos de su cuenta".', 'What they said or signed, and when. For example: "Agreed by phone to get notices about their account".')} className="mt-4">
                            <textarea name="evidence" className="input min-h-20" required minLength={3} maxLength={400} data-testid="consent-evidence" />
                          </Field>
                          <div className="mt-4"><Submit testId="consent-save">{t('Registrar', 'Record')}</Submit></div>
                        </ActionForm>
                      </Dialog>
                      {(c.phone || c.email) && (
                        <Dialog trigger={t('Registrar baja', 'Record opt-out')} title={t(`Baja de ${c.full_name}`, `Opt-out for ${c.full_name}`)} variant="quiet" size="sm" testId="optout-open">
                          <ActionForm action={A.optOutAction} onOk="close">
                            <input type="hidden" name="market" value={a.market_code} />
                            <p className="mb-4 text-[14px] text-strong">{t('Esa dirección deja de recibir mensajes por el canal que elijas. Levantar una baja lo hace quien lidera el mercado, y solo si la persona lo pide.', 'That address stops getting messages on the channel you choose. Only whoever leads the market can lift an opt-out, and only if the person asks.')}</p>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field label={t('Dirección', 'Address')}>
                                <select name="address" className="input" data-testid="optout-address">
                                  {c.phone && <option value={c.phone}>{c.phone}</option>}
                                  {c.email && <option value={c.email}>{c.email}</option>}
                                </select>
                              </Field>
                              <Field label={t('Canal', 'Channel')}>
                                <select name="channel" className="input" defaultValue="all" data-testid="optout-channel">{(['all', ...CHANNELS] as const).map((k) => <option key={k} value={k}>{pair(CHANNEL_LABEL, k)}</option>)}</select>
                              </Field>
                            </div>
                            <Field label={t('Qué pidió (opcional)', 'What they asked (optional)')} className="mt-4"><input name="reason" className="input" maxLength={200} /></Field>
                            <div className="mt-4"><Submit testId="optout-save">{t('Registrar baja', 'Record opt-out')}</Submit></div>
                          </ActionForm>
                        </Dialog>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
