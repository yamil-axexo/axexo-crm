# Domain events v1 (outbox)

Generated from `src/domain/events/catalog.ts`. Do not edit by hand: run `UPDATE_CONTRACTS=1 pnpm vitest run tests/unit/eventos-api-contracts.test.ts`.

Status: **built, delivery channel off**. Every domain change writes its event in the same transaction as the change (`crm.outbox_events`, insert only). A publisher job hands each event to the subscribers that asked for it, retries with growing waits and keeps dead letters for manual resend. Real HTTP delivery is an adapter that stays off until the transport is approved (Tech Implementation Review).

## Envelope

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | uuid | Event id. Stable across retries: use it to discard repeats. |
| `type` | string | Event name, `<record>.<what happened>`. |
| `version` | integer | Schema version of this event type. A breaking change bumps it. |
| `occurred_at` | date-time | When the change was committed (UTC). |
| `market` | string or null | Market code. |
| `aggregate` | object | `{ type, id }` of the record the event is about. |
| `data` | object | Event data. Events that go out with the audit log carry field names that changed and who changed them, never values or personal data. |

## Delivery

- `POST` to the subscriber destination (https only), JSON body, headers `x-contigo-event`, `x-contigo-event-id`, `x-contigo-delivery` and `x-contigo-signature: t=<unix seconds>,v1=<hex>`.
- Signature: HMAC-SHA256 of `<t>.<body>` with the subscriber secret. The secret is derived on the server and never stored in the database; it is shown once on creation and on rotation.
- Any 2xx is success. Anything else is retried after 1, 5, 30 and 120 minutes; the fifth failure moves the delivery to dead letters, where an administrator can resend it.
- At-least-once: a subscriber can receive the same event twice and must discard repeats by `id`.

## Catalog (79 events)

| Event | Version | About | Data |
| --- | --- | --- | --- |
| `account_type.created` | 1 | Added an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account_type.restored` | 1 | Restored an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account_type.retired` | 1 | Retired an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account.alias_issued` | 1 | CONTIGO linked its merchant ID to another system’s ID. | `system` (string), `external_id` (string), `account_id` (uuid) |
| `account.created` | 1 | A merchant was created. | `kind` (string) |
| `account.custom_updated` | 1 | Edited a merchant’s additional fields. | `changed` (string[]), `actor_id` (uuid) |
| `account.merchant_ref` | 1 | Changed a merchant’s Merchant ID. | `changed` (string[]), `actor_id` (uuid) |
| `account.merged` | 1 | A duplicate merchant was merged into this one. | `source_id` (uuid) |
| `account.parent_changed` | 1 | Changed a merchant’s parent. | `changed` (string[]), `actor_id` (uuid) |
| `account.reassigned` | 1 | Merchants were moved to another person. The record is whoever receives them. | `count` (integer) |
| `account.taken` | 1 | Took a store with no owner. | `changed` (string[]), `actor_id` (uuid) |
| `account.territory_set` | 1 | Changed the territory of merchants. | `changed` (string[]), `actor_id` (uuid) |
| `account.type_changed` | 1 | Changed a merchant’s account type. | `changed` (string[]), `actor_id` (uuid) |
| `account.updated` | 1 | Edited a merchant. | `changed` (string[]), `actor_id` (uuid) |
| `activity.added` | 1 | Logged an activity. | `changed` (string[]), `actor_id` (uuid) |
| `activity.completed` | 1 | Completed an activity. | `changed` (string[]), `actor_id` (uuid) |
| `contact.added` | 1 | Added a contact. | `changed` (string[]), `actor_id` (uuid) |
| `contact.primary_set` | 1 | Changed the primary contact. | `changed` (string[]), `actor_id` (uuid) |
| `deal.created` | 1 | A deal was opened. | `account_id` (uuid) |
| `deal.custom_updated` | 1 | Edited a deal’s additional fields. | `changed` (string[]), `actor_id` (uuid) |
| `deal.handed_to_ops` | 1 | Handed a deal over to Operations. | `changed` (string[]), `actor_id` (uuid) |
| `deal.item_added` | 1 | Added a line to the order. | `changed` (string[]), `actor_id` (uuid) |
| `deal.item_removed` | 1 | Removed a line from the order. | `changed` (string[]), `actor_id` (uuid) |
| `deal.ops_check` | 1 | Changed a provider or document status. | `changed` (string[]), `actor_id` (uuid) |
| `deal.ops_taken` | 1 | Took a deal in Operations. | `changed` (string[]), `actor_id` (uuid) |
| `deal.paused` | 1 | Put a deal on hold. | `changed` (string[]), `actor_id` (uuid) |
| `deal.reassigned` | 1 | Open deals were moved to another person. | `count` (integer) |
| `deal.resumed` | 1 | Resumed a deal on hold. | `changed` (string[]), `actor_id` (uuid) |
| `deal.returned_to_sales` | 1 | Sent a deal back to Sales. | `changed` (string[]), `actor_id` (uuid) |
| `deal.stage_changed` | 1 | A deal moved to another stage. | `from` (uuid), `to` (uuid), `kind` (string) |
| `deal.training` | 1 | Changed a deal’s training. | `changed` (string[]), `actor_id` (uuid) |
| `deal.updated` | 1 | Edited a deal. | `changed` (string[]), `actor_id` (uuid) |
| `deal.won` | 1 | A deal was won by the merchant’s first transaction. | `account_id` (uuid), `closed_by` (string) |
| `exception.dismissed` | 1 | Dismissed an alert. | `changed` (string[]), `actor_id` (uuid) |
| `exception.scheduled` | 1 | Handled an alert with a next step. | `changed` (string[]), `actor_id` (uuid) |
| `field.created` | 1 | Created a field. | `changed` (string[]), `actor_id` (uuid) |
| `field.restored` | 1 | Restored a field. | `changed` (string[]), `actor_id` (uuid) |
| `field.retired` | 1 | Retired a field. | `changed` (string[]), `actor_id` (uuid) |
| `form.updated` | 1 | Edited a web form. | `changed` (string[]), `actor_id` (uuid) |
| `fx.rate_set` | 1 | Loaded an exchange rate. | `changed` (string[]), `actor_id` (uuid) |
| `lead.assigned` | 1 | A lead was assigned to someone. | `owner_id` (uuid), `previous_owner_id` (uuid, optional), `by` (string), `motor` (string, optional), `sla_due` (boolean, optional) |
| `lead.attempted` | 1 | Tried to reach a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.contacted` | 1 | Reached a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.converted` | 1 | A lead became a merchant with its deal. | `account_id` (uuid), `deal_id` (uuid) |
| `lead.created` | 1 | A lead came in. | `source` (string), `motor` (string) |
| `lead.disqualified` | 1 | Disqualified a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.qualified` | 1 | Qualified a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.reassigned` | 1 | Open leads were moved to another person. | `count` (integer) |
| `lead.released` | 1 | Released a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.repeat_request` | 1 | Another web request came in from the same business. | `changed` (string[]), `actor_id` (uuid) |
| `lead.updated` | 1 | Fixed a lead’s type or role. | `changed` (string[]), `actor_id` (uuid) |
| `loss_reason.created` | 1 | Added a loss reason. | `changed` (string[]), `actor_id` (uuid) |
| `loss_reason.updated` | 1 | Edited a loss reason. | `changed` (string[]), `actor_id` (uuid) |
| `membership.ended` | 1 | Removed access. | `changed` (string[]), `actor_id` (uuid) |
| `membership.expiry_changed` | 1 | Changed when an access expires. | `changed` (string[]), `actor_id` (uuid) |
| `membership.granted` | 1 | Granted access. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.catalog_created` | 1 | Added an item to an Operations catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.catalog_updated` | 1 | Edited an item in an Operations catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.configured` | 1 | Changed a pipeline’s closing rule. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.created` | 1 | Created a pipeline. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.ops_configured` | 1 | Changed a pipeline’s order and Operations settings. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.product_created` | 1 | Added a product to the catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.product_updated` | 1 | Edited a catalog product. | `changed` (string[]), `actor_id` (uuid) |
| `routing.hours_updated` | 1 | Changed a market’s business hours. | `changed` (string[]), `actor_id` (uuid) |
| `routing.members_changed` | 1 | Changed a lead rotation. | `changed` (string[]), `actor_id` (uuid) |
| `stage.archived` | 1 | Archived a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.created` | 1 | Added a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.reordered` | 1 | Reordered a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.updated` | 1 | Edited a stage. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.added` | 1 | Added a street seller. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.ended` | 1 | Removed a street seller. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.updated` | 1 | Changed who a street seller reports to. | `changed` (string[]), `actor_id` (uuid) |
| `team.created` | 1 | Created a team. | `changed` (string[]), `actor_id` (uuid) |
| `territory.archived` | 1 | Archived a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.created` | 1 | Created a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.renamed` | 1 | Renamed a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.restored` | 1 | Restored a territory. | `changed` (string[]), `actor_id` (uuid) |
| `user.bootstrap_admin` | 1 | Got Administration from the environment’s bootstrap list. | `changed` (string[]), `actor_id` (uuid) |
| `user.territories_changed` | 1 | Changed a person’s territories. | `changed` (string[]), `actor_id` (uuid) |

## Example and schema

One explicit event and one audit-driven event, in full. Every other event follows the same envelope with the data listed above.

### deal.stage_changed v1

```json
{
  "id": "0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f",
  "type": "deal.stage_changed",
  "version": 1,
  "occurred_at": "2026-11-12T15:04:05.000Z",
  "market": "MX",
  "aggregate": {
    "type": "deal",
    "id": "0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f"
  },
  "data": {
    "from": "0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f",
    "to": "0193a1f0-8d2f-7c3b-8e4f-6b2c3d4e5f60",
    "kind": "open"
  }
}
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "contigo/events/deal.stage_changed/v1",
  "type": "object",
  "required": [
    "id",
    "type",
    "version",
    "occurred_at",
    "aggregate",
    "data"
  ],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "type": {
      "const": "deal.stage_changed"
    },
    "version": {
      "const": 1
    },
    "occurred_at": {
      "type": "string",
      "format": "date-time"
    },
    "market": {
      "type": [
        "string",
        "null"
      ]
    },
    "aggregate": {
      "type": "object",
      "required": [
        "type",
        "id"
      ],
      "properties": {
        "type": {
          "const": "deal"
        },
        "id": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "data": {
      "type": "object",
      "required": [
        "from",
        "to",
        "kind"
      ],
      "properties": {
        "from": {
          "type": "string",
          "format": "uuid",
          "description": "Previous stage."
        },
        "to": {
          "type": "string",
          "format": "uuid",
          "description": "New stage."
        },
        "kind": {
          "type": "string",
          "description": "Kind of the new stage: open, awaiting_txn, won or lost."
        }
      }
    }
  }
}
```

### account.updated v1

```json
{
  "id": "0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f",
  "type": "account.updated",
  "version": 1,
  "occurred_at": "2026-11-12T15:04:05.000Z",
  "market": "MX",
  "aggregate": {
    "type": "account",
    "id": "0193a1f0-7c1e-7b2a-9d3e-5a1b2c3d4e5f"
  },
  "data": {
    "changed": [
      "name"
    ],
    "actor_id": "0193a1f0-8d2f-7c3b-8e4f-6b2c3d4e5f60"
  }
}
```

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "contigo/events/account.updated/v1",
  "type": "object",
  "required": [
    "id",
    "type",
    "version",
    "occurred_at",
    "aggregate",
    "data"
  ],
  "additionalProperties": false,
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid"
    },
    "type": {
      "const": "account.updated"
    },
    "version": {
      "const": 1
    },
    "occurred_at": {
      "type": "string",
      "format": "date-time"
    },
    "market": {
      "type": [
        "string",
        "null"
      ]
    },
    "aggregate": {
      "type": "object",
      "required": [
        "type",
        "id"
      ],
      "properties": {
        "type": {
          "const": "account"
        },
        "id": {
          "type": "string",
          "format": "uuid"
        }
      }
    },
    "data": {
      "type": "object",
      "required": [
        "changed",
        "actor_id"
      ],
      "properties": {
        "changed": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Names of the fields that changed (no values)."
        },
        "actor_id": {
          "type": "string",
          "format": "uuid",
          "description": "Who made the change."
        }
      }
    }
  }
}
```

## What does not emit an event, and why

| Audit action | Meaning | Why it is not published |
| --- | --- | --- |
| `activity.notice_seen` | Marked a notice as seen | It is a notice between people inside CONTIGO, not a change to the record. |
| `activity.notice_sent` | Notified someone from a note | It is a notice between people inside CONTIGO, not a change to the record. |
| `api_client.created` | Created an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `api_client.revoked` | Revoked an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `api_client.rotated` | Rotated an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `csv_import.completed` | Imported a file | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `csv_import.undone` | Undid an import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `event_delivery.resent` | Resent an event to a subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.created` | Added an event subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.secret_rotated` | Rotated an event subscriber’s secret | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.status_changed` | Paused, resumed or removed an event subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `export.alert` | Went over the daily export threshold | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `import.cancelled` | Stopped the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.completed` | The Pipedrive import finished | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.raw_purged` | Emptied the raw Pipedrive copy | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.resumed` | Resumed the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.started` | Started the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `inbound.replayed` | Reprocessed a held message | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `integration.dead_letter` | A Sales App message went to dead letters | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.merchant_approved` | A merchant’s approval arrived | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.metrics_loaded` | The daily sales file was loaded | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.metrics_quarantined` | Sales file set aside for review | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.onboarding_received` | A merchant’s onboarding arrived from the Sales App | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.simulated` | Tested an integration from Administration | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.visit_received` | A Sales App visit came in | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `report.answered` | Answered a team report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `report.created` | Reported a problem or asked for something | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `report.exported` | Exported a report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `rules.evaluated` | Ran the rules by hand | Running the rules opens or closes internal notices; it changes no merchants, leads or deals. |
| `session.ended` | Signed out | Sign-ins and sign-outs do not change business data. |
| `session.started` | Signed in | Sign-ins and sign-outs do not change business data. |
