import { z } from 'zod'
import { eventCatalog, eventExample, eventSchema, silentActions } from '@/domain/events/catalog'
import { API_ERRORS, API_PAGE, API_RESOURCES, CATALOGS, openApi } from '@/domain/api-spec'
import { FIELD_MATRIX, INBOUND_EVENTS, OWNER_LABEL } from '@/domain/events/sales-app-contract'
import { SALES_APP_EVENTS } from '@/domain/integrations'

// Documentos de contrato generados desde el código: lo que está en docs/contracts/ es exactamente lo que la app hace.
// tests/unit/eventos-api-contracts.test.ts falla si un archivo quedó viejo; con UPDATE_CONTRACTS=1 los vuelve a escribir.
const json = (v: unknown) => '```json\n' + JSON.stringify(v, null, 2) + '\n```'

export function domainEventsDoc(): string {
  const cat = eventCatalog()
  const out = [
    '# Domain events v1 (outbox)',
    '',
    'Generated from `src/domain/events/catalog.ts`. Do not edit by hand: run `UPDATE_CONTRACTS=1 pnpm vitest run tests/unit/eventos-api-contracts.test.ts`.',
    '',
    'Status: **built, delivery channel off**. Every domain change writes its event in the same transaction as the change (`crm.outbox_events`, insert only). A publisher job hands each event to the subscribers that asked for it, retries with growing waits and keeps dead letters for manual resend. Real HTTP delivery is an adapter that stays off until the transport is approved (Tech Implementation Review).',
    '',
    '## Envelope',
    '',
    '| Field | Type | Meaning |',
    '| --- | --- | --- |',
    '| `id` | uuid | Event id. Stable across retries: use it to discard repeats. |',
    '| `type` | string | Event name, `<record>.<what happened>`. |',
    '| `version` | integer | Schema version of this event type. A breaking change bumps it. |',
    '| `occurred_at` | date-time | When the change was committed (UTC). |',
    '| `market` | string or null | Market code. |',
    '| `aggregate` | object | `{ type, id }` of the record the event is about. |',
    '| `data` | object | Event data. Events that go out with the audit log carry field names that changed and who changed them, never values or personal data. |',
    '',
    '## Delivery',
    '',
    '- `POST` to the subscriber destination (https only), JSON body, headers `x-contigo-event`, `x-contigo-event-id`, `x-contigo-delivery` and `x-contigo-signature: t=<unix seconds>,v1=<hex>`.',
    '- Signature: HMAC-SHA256 of `<t>.<body>` with the subscriber secret. The secret is derived on the server and never stored in the database; it is shown once on creation and on rotation.',
    '- Any 2xx is success. Anything else is retried after 1, 5, 30 and 120 minutes; the fifth failure moves the delivery to dead letters, where an administrator can resend it.',
    '- At-least-once: a subscriber can receive the same event twice and must discard repeats by `id`.',
    '',
    `## Catalog (${cat.length} events)`,
    '',
    '| Event | Version | About | Data |',
    '| --- | --- | --- | --- |',
    ...cat.map((e) => `| \`${e.type}\` | ${e.version} | ${e.about[1]} | ${Object.entries(e.data).map(([k, f]) => `\`${k}\` (${f.type}${f.required === false ? ', optional' : ''})`).join(', ')} |`),
    '',
    '## Example and schema',
    '',
    'One explicit event and one audit-driven event, in full. Every other event follows the same envelope with the data listed above.',
    '',
    ...[cat.find((e) => e.type === 'deal.stage_changed')!, cat.find((e) => e.type === 'account.updated')!].flatMap((e) => [`### ${e.type} v${e.version}`, '', json(eventExample(e)), '', json(eventSchema(e)), '']),
    '## What does not emit an event, and why',
    '',
    '| Audit action | Meaning | Why it is not published |',
    '| --- | --- | --- |',
    ...silentActions().map((s) => `| \`${s.action}\` | ${s.label[1]} | ${s.why[1]} |`),
    '',
  ]
  return out.join('\n')
}

export function apiDoc(): string {
  const out = [
    '# Read API v1',
    '',
    'Generated from `src/domain/api-spec.ts`. Do not edit by hand: run `UPDATE_CONTRACTS=1 pnpm vitest run tests/unit/eventos-api-contracts.test.ts`. The OpenAPI document is `api-v1.openapi.json`.',
    '',
    '- Read only, versioned in the path (`/api/v1`).',
    '- `Authorization: Bearer ctg_...`. A read key belongs to **one market** and carries only the scopes it was given. It reads with the identity of the person who created it (the same database policies as their screen), never more; if that person loses access to the market, the key stops reading.',
    `- Cursor pagination: \`limit\` (1 to ${API_PAGE.max}, default ${API_PAGE.default}) and \`cursor\` (the previous page's \`next_cursor\`). Records come oldest first. \`next_cursor\` is \`null\` on the last page.`,
    '- Unknown parameters are rejected with 400, not ignored.',
    '- Rate limit, enforced in the database with a sliding window: per key (set on the key, default 120 per minute) and per IP address (300 per minute). Over the limit: `429` with `Retry-After` in seconds. Twenty invalid keys in a minute from one address also get `429`.',
    '- Rotation: rotating a key creates a new one with the same market and scopes; the previous one stays valid until its retirement date (1 to 30 days) and then stops working on its own. Revoking cuts it immediately.',
    '- Test keys (`ctg_test_...`) read a fixed synthetic dataset generated in memory, with made-up names. They never touch business tables, in any environment. Responses carry `x-contigo-data: synthetic`.',
    '- No phones, emails, contact names, note text or activity subjects are exposed in v1.',
    '',
    '## Resources',
    '',
    ...API_RESOURCES.flatMap((r) => [
      `### GET ${r.path}`,
      '',
      `Scope \`${r.scope}\`. ${r.about[1]}`,
      '',
      'Filters:',
      '',
      ...r.filters.map((f) => `- \`${f.name}\`: ${f.about[1]}${f.values ? ` One of: ${f.values.join(', ')}.` : ''}`),
      '',
      '| Field | Type | Meaning |',
      '| --- | --- | --- |',
      ...r.fields.map((f) => `| \`${f.name}\` | ${f.type}${f.nullable ? ' or null' : ''} | ${f.about[1]} |`),
      '',
    ]),
    `### GET ${CATALOGS.path}`,
    '',
    `Scope \`${CATALOGS.scope}\`. ${CATALOGS.about[1]}`,
    '',
    '## Errors',
    '',
    '| Status | Code | Meaning |',
    '| --- | --- | --- |',
    ...API_ERRORS.map((e) => `| ${e.status} | \`${e.code}\` | ${e.about[1]} |`),
    '',
  ]
  return out.join('\n')
}

export const openApiDoc = (): string => JSON.stringify(openApi(), null, 2) + '\n'

/** Esquemas JSON de los eventos que CONTIGO recibe de la Sales App, sacados de la misma validación que usa la entrada. */
export function salesAppSchemas(): string {
  const schemas = Object.fromEntries(SALES_APP_EVENTS.map((e) => [e.shape.type.value, z.toJSONSchema(e, { io: 'input' })]))
  return JSON.stringify({ $comment: 'Generated from src/domain/integrations.ts. Sales App to CONTIGO, contract v1.', events: schemas }, null, 2) + '\n'
}

/** Sección generada de docs/contracts/sales-app-events-v1.md: eventos y matriz de campos. */
export function salesAppMatrixDoc(): string {
  return [
    '<!-- generated:matrix:start -->',
    '## Events CONTIGO receives (v1)',
    '',
    '| Event | Version | About | Required data |',
    '| --- | --- | --- | --- |',
    ...INBOUND_EVENTS.map((e) => `| \`${e.type}\` | ${e.version} | ${e.about[1]} | ${e.required.map((r) => `\`${r}\``).join(', ')} |`),
    '',
    'JSON Schemas: `sales-app-events-v1.schema.json` (generated from the same validation the endpoint runs).',
    '',
    '## Field matrix: which system wins each field',
    '',
    '| Data | Owner | Travels in | Rule |',
    '| --- | --- | --- | --- |',
    ...FIELD_MATRIX.map((r) => `| ${r.field[1]} | ${OWNER_LABEL[r.owner][1]} | \`${r.travels}\` | ${r.rule[1]} |`),
    '',
    '## One store creator',
    '',
    'A store is looked up by its Sales Core id; if absent, by phone within the market (the prospect CONTIGO already had); only if neither exists is it created. `store.created` and `onboarding.submitted` share this path, so whichever arrives second links to the existing merchant and never duplicates it.',
    '',
    '## Dead letters and replay',
    '',
    'A message that does not match the contract is answered with `422` and kept in dead letters with a short reason (`unknown_type`, `unsupported_version`, `invalid_field:<path>`), scrubbed of prohibited data and capped in size. A valid message about a store CONTIGO does not know yet is kept as held (`unknown customer_id`). Both can be reprocessed from Administration; a replay runs on the same row, so idempotency by `event_id` still holds.',
    '<!-- generated:matrix:end -->',
  ].join('\n')
}
