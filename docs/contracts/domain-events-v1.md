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

## Catalog (231 events)

| Event | Version | About | Data |
| --- | --- | --- | --- |
| `account_type.created` | 1 | Added an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account_type.depth_set` | 1 | Changed how many levels an account type allows. | `changed` (string[]), `actor_id` (uuid) |
| `account_type.restored` | 1 | Restored an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account_type.retired` | 1 | Retired an account type. | `changed` (string[]), `actor_id` (uuid) |
| `account.address_set` | 1 | Changed a merchant’s address. | `changed` (string[]), `actor_id` (uuid) |
| `account.alias_issued` | 1 | CONTIGO linked its merchant ID to another system’s ID. | `system` (string), `external_id` (string), `account_id` (uuid) |
| `account.carrier_detail_set` | 1 | Changed a carrier’s details on a store. | `changed` (string[]), `actor_id` (uuid) |
| `account.carrier_label_set` | 1 | Changed the name of the ID a carrier issues. | `changed` (string[]), `actor_id` (uuid) |
| `account.created` | 1 | A merchant was created. | `kind` (string) |
| `account.custom_updated` | 1 | Edited a merchant’s additional fields. | `changed` (string[]), `actor_id` (uuid) |
| `account.lifecycle_corrected` | 1 | Moved a merchant back to onboarding after a correction. | `changed` (string[]), `actor_id` (uuid) |
| `account.located` | 1 | Saved a merchant’s location. | `changed` (string[]), `actor_id` (uuid) |
| `account.location_cleared` | 1 | Removed a merchant’s location. | `changed` (string[]), `actor_id` (uuid) |
| `account.merchant_ref` | 1 | Changed a merchant’s Merchant ID. | `changed` (string[]), `actor_id` (uuid) |
| `account.merged` | 1 | A duplicate merchant was merged into this one. | `source_id` (uuid) |
| `account.milestone_corrected` | 1 | Corrected a merchant’s sales milestone. | `changed` (string[]), `actor_id` (uuid) |
| `account.origin_set` | 1 | Set a merchant’s origin. | `changed` (string[]), `actor_id` (uuid) |
| `account.owner_by_territory` | 1 | A store went to its territory manager. | `changed` (string[]), `actor_id` (uuid) |
| `account.parent_changed` | 1 | Changed a merchant’s parent. | `changed` (string[]), `actor_id` (uuid) |
| `account.product_set` | 1 | Changed a merchant’s product or its provider status. | `changed` (string[]), `actor_id` (uuid) |
| `account.profile_set` | 1 | Changed a merchant’s entity, business unit or time zone. | `changed` (string[]), `actor_id` (uuid) |
| `account.reassigned` | 1 | Merchants were moved to another person. The record is whoever receives them. | `count` (integer) |
| `account.recruiter_set` | 1 | Set who recruited a store. | `changed` (string[]), `actor_id` (uuid) |
| `account.referral_code_created` | 1 | Created a merchant’s referral link. | `changed` (string[]), `actor_id` (uuid) |
| `account.referral_code_toggled` | 1 | Turned a merchant’s referral link on or off. | `changed` (string[]), `actor_id` (uuid) |
| `account.referral_qualified` | 1 | A referral from this merchant made its first sale. | `changed` (string[]), `actor_id` (uuid) |
| `account.store_profile_set` | 1 | Changed a store’s site number, business type or earlier carriers. | `changed` (string[]), `actor_id` (uuid) |
| `account.taken` | 1 | Took a store with no owner. | `changed` (string[]), `actor_id` (uuid) |
| `account.tax_id_set` | 1 | Changed the last 4 of a store’s Tax ID. | `changed` (string[]), `actor_id` (uuid) |
| `account.team_added` | 1 | Added someone to the account team. | `changed` (string[]), `actor_id` (uuid) |
| `account.team_removed` | 1 | Removed someone from the account team. | `changed` (string[]), `actor_id` (uuid) |
| `account.territory_set` | 1 | Changed the territory of merchants. | `changed` (string[]), `actor_id` (uuid) |
| `account.ticket_linked` | 1 | Linked a support ticket to a merchant’s thread. | `changed` (string[]), `actor_id` (uuid) |
| `account.ticket_status_changed` | 1 | Changed the status of a support ticket. | `changed` (string[]), `actor_id` (uuid) |
| `account.type_changed` | 1 | Changed a merchant’s account type. | `changed` (string[]), `actor_id` (uuid) |
| `account.unmerged` | 1 | Undid a merchant merge. | `changed` (string[]), `actor_id` (uuid) |
| `account.updated` | 1 | Edited a merchant. | `changed` (string[]), `actor_id` (uuid) |
| `account.whatsapp_window` | 1 | Noted that the merchant wrote on WhatsApp. | `changed` (string[]), `actor_id` (uuid) |
| `activity.added` | 1 | Logged an activity. | `changed` (string[]), `actor_id` (uuid) |
| `activity.comm_captured` | 1 | Logged an email, a meeting or a message in the thread. | `changed` (string[]), `actor_id` (uuid) |
| `activity.completed` | 1 | Completed an activity. | `changed` (string[]), `actor_id` (uuid) |
| `activity.corrected` | 1 | Corrected an activity with a new entry. | `changed` (string[]), `actor_id` (uuid) |
| `activity.revisit_scheduled` | 1 | Scheduled the revisit to the decision-maker. | `changed` (string[]), `actor_id` (uuid) |
| `agency.created` | 1 | Created an agency. | `changed` (string[]), `actor_id` (uuid) |
| `agency.labels_set` | 1 | Changed who counts as an agency. | `changed` (string[]), `actor_id` (uuid) |
| `alias_system.created` | 1 | Added a source system for identifiers. | `changed` (string[]), `actor_id` (uuid) |
| `alias.added` | 1 | Added an ID from another system to a merchant. | `changed` (string[]), `actor_id` (uuid) |
| `alias.closed` | 1 | Closed a merchant’s ID from another system. | `changed` (string[]), `actor_id` (uuid) |
| `attribution.corrected` | 1 | Corrected a merchant’s attribution (new row). | `changed` (string[]), `actor_id` (uuid) |
| `automation.created` | 1 | Created an automation. | `changed` (string[]), `actor_id` (uuid) |
| `automation.paused` | 1 | Paused an automation. | `changed` (string[]), `actor_id` (uuid) |
| `automation.resumed` | 1 | Turned an automation on. | `changed` (string[]), `actor_id` (uuid) |
| `automation.updated` | 1 | Edited an automation. | `changed` (string[]), `actor_id` (uuid) |
| `channel.assigned` | 1 | Assigned a merchant’s channel. | `changed` (string[]), `actor_id` (uuid) |
| `claim.extended` | 1 | Extended a channel registration with evidence. | `changed` (string[]), `actor_id` (uuid) |
| `claim.registered` | 1 | Registered a store for a channel. | `changed` (string[]), `actor_id` (uuid) |
| `claim.rejected` | 1 | Rejected a channel registration with a reason. | `changed` (string[]), `actor_id` (uuid) |
| `competitor.added` | 1 | Added a competitor to the list. | `changed` (string[]), `actor_id` (uuid) |
| `competitor.observed` | 1 | Recorded competition at a store. | `changed` (string[]), `actor_id` (uuid) |
| `contact.added` | 1 | Added a contact. | `changed` (string[]), `actor_id` (uuid) |
| `contact.ended` | 1 | Removed a contact from an account. | `changed` (string[]), `actor_id` (uuid) |
| `contact.primary_set` | 1 | Changed the primary contact. | `changed` (string[]), `actor_id` (uuid) |
| `contact.updated` | 1 | Edited a contact. | `changed` (string[]), `actor_id` (uuid) |
| `contract.created` | 1 | Created a contract from the terms. | `changed` (string[]), `actor_id` (uuid) |
| `contract.renewal_noticed` | 1 | Gave notice that a contract is due for renewal. | `changed` (string[]), `actor_id` (uuid) |
| `contract.renewed` | 1 | Created a contract renewal. | `changed` (string[]), `actor_id` (uuid) |
| `contract.signed` | 1 | Marked a contract as signed. | `changed` (string[]), `actor_id` (uuid) |
| `contract.status_changed` | 1 | Changed a contract’s status. | `changed` (string[]), `actor_id` (uuid) |
| `credit.decided` | 1 | Approved or rejected a credit limit. | `changed` (string[]), `actor_id` (uuid) |
| `credit.requested` | 1 | Requested a credit limit. | `changed` (string[]), `actor_id` (uuid) |
| `deal.approval_approved` | 1 | Approved a step. | `changed` (string[]), `actor_id` (uuid) |
| `deal.approval_escalated` | 1 | An approval ran out of time and went to the backup. | `changed` (string[]), `actor_id` (uuid) |
| `deal.approval_rejected` | 1 | Declined a step. | `changed` (string[]), `actor_id` (uuid) |
| `deal.approval_requested` | 1 | Asked for approval of a step. | `changed` (string[]), `actor_id` (uuid) |
| `deal.contact_role_ended` | 1 | Removed a person from a deal. | `changed` (string[]), `actor_id` (uuid) |
| `deal.contact_role_set` | 1 | Set or changed a person’s role on a deal. | `changed` (string[]), `actor_id` (uuid) |
| `deal.created` | 1 | A deal was opened. | `account_id` (uuid) |
| `deal.custom_updated` | 1 | Edited a deal’s additional fields. | `changed` (string[]), `actor_id` (uuid) |
| `deal.evidence_added` | 1 | Added evidence to a deal. | `changed` (string[]), `actor_id` (uuid) |
| `deal.funded` | 1 | The first funding moved a deal to waiting for the first sale. | `changed` (string[]), `actor_id` (uuid) |
| `deal.handed_to_ops` | 1 | Handed a deal over to Operations. | `changed` (string[]), `actor_id` (uuid) |
| `deal.item_added` | 1 | Added a line to the order. | `changed` (string[]), `actor_id` (uuid) |
| `deal.item_removed` | 1 | Removed a line from the order. | `changed` (string[]), `actor_id` (uuid) |
| `deal.ops_assigned` | 1 | A deal was assigned to the Operations lead. | `changed` (string[]), `actor_id` (uuid) |
| `deal.ops_check` | 1 | Changed a provider or document status. | `changed` (string[]), `actor_id` (uuid) |
| `deal.ops_taken` | 1 | Took a deal in Operations. | `changed` (string[]), `actor_id` (uuid) |
| `deal.order_updated` | 1 | Edited an order’s shipping details. | `changed` (string[]), `actor_id` (uuid) |
| `deal.owner_changed` | 1 | A deal changed owner. | `owner_id` (uuid) |
| `deal.paused` | 1 | Put a deal on hold. | `changed` (string[]), `actor_id` (uuid) |
| `deal.reassigned` | 1 | Open deals were moved to another person. | `count` (integer) |
| `deal.resumed` | 1 | Resumed a deal on hold. | `changed` (string[]), `actor_id` (uuid) |
| `deal.returned_to_sales` | 1 | Sent a deal back to Sales. | `changed` (string[]), `actor_id` (uuid) |
| `deal.stage_changed` | 1 | A deal moved to another stage. | `from` (uuid), `to` (uuid), `kind` (string) |
| `deal.training` | 1 | Changed a deal’s training. | `changed` (string[]), `actor_id` (uuid) |
| `deal.turn_assigned` | 1 | A deal went in turn to another person. | `changed` (string[]), `actor_id` (uuid) |
| `deal.updated` | 1 | Edited a deal. | `changed` (string[]), `actor_id` (uuid) |
| `deal.waiting_on` | 1 | Changed who a deal is waiting on. | `changed` (string[]), `actor_id` (uuid) |
| `deal.win_corrected` | 1 | Reopened a won deal: the first sale was corrected. | `changed` (string[]), `actor_id` (uuid) |
| `deal.win_redated` | 1 | Corrected the date a deal was won. | `changed` (string[]), `actor_id` (uuid) |
| `deal.won` | 1 | A deal was won by the merchant’s first transaction. | `account_id` (uuid), `closed_by` (string) |
| `deal.won_on_migration` | 1 | Deal won on the real migration date. | `changed` (string[]), `actor_id` (uuid) |
| `dispute.raised` | 1 | Raised an attribution dispute. | `changed` (string[]), `actor_id` (uuid) |
| `dispute.resolved` | 1 | Resolved an attribution dispute. | `changed` (string[]), `actor_id` (uuid) |
| `entity.created` | 1 | Added a legal entity. | `changed` (string[]), `actor_id` (uuid) |
| `entity.updated` | 1 | Edited a legal entity. | `changed` (string[]), `actor_id` (uuid) |
| `exception.dismissed` | 1 | Dismissed an alert. | `changed` (string[]), `actor_id` (uuid) |
| `exception.scheduled` | 1 | Handled an alert with a next step. | `changed` (string[]), `actor_id` (uuid) |
| `field.approved` | 1 | Approved a proposed field. | `changed` (string[]), `actor_id` (uuid) |
| `field.created` | 1 | Created a field. | `changed` (string[]), `actor_id` (uuid) |
| `field.proposed` | 1 | Proposed a new field. | `changed` (string[]), `actor_id` (uuid) |
| `field.rejected` | 1 | Rejected a proposed field. | `changed` (string[]), `actor_id` (uuid) |
| `field.restored` | 1 | Restored a field. | `changed` (string[]), `actor_id` (uuid) |
| `field.retired` | 1 | Retired a field. | `changed` (string[]), `actor_id` (uuid) |
| `field.section_set` | 1 | Moved a field to another section. | `changed` (string[]), `actor_id` (uuid) |
| `field.updated` | 1 | Edited a registry field. | `changed` (string[]), `actor_id` (uuid) |
| `form.campaign_set` | 1 | Changed a form’s campaign group, channel or company types. | `changed` (string[]), `actor_id` (uuid) |
| `form.created` | 1 | Created a web form. | `changed` (string[]), `actor_id` (uuid) |
| `form.toggled` | 1 | Turned a web form on or off. | `changed` (string[]), `actor_id` (uuid) |
| `form.updated` | 1 | Edited a web form. | `changed` (string[]), `actor_id` (uuid) |
| `fx.rate_set` | 1 | Loaded an exchange rate. | `changed` (string[]), `actor_id` (uuid) |
| `lead.assigned` | 1 | A lead was assigned to someone. | `owner_id` (uuid), `previous_owner_id` (uuid, optional), `by` (string), `motor` (string, optional), `sla_due` (boolean, optional) |
| `lead.attempted` | 1 | Tried to reach a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.contacted` | 1 | Reached a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.converted` | 1 | A lead became a merchant with its deal. | `account_id` (uuid), `deal_id` (uuid) |
| `lead.created` | 1 | A lead came in. | `source` (string), `motor` (string) |
| `lead.disqualified` | 1 | Disqualified a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.escalated` | 1 | Escalated a lead with no first contact. | `changed` (string[]), `actor_id` (uuid) |
| `lead.label_created` | 1 | Added a lead label. | `changed` (string[]), `actor_id` (uuid) |
| `lead.labels_changed` | 1 | Changed a lead’s labels. | `changed` (string[]), `actor_id` (uuid) |
| `lead.linked_to_account` | 1 | Linked a lead to an existing merchant. | `changed` (string[]), `actor_id` (uuid) |
| `lead.qualified` | 1 | Qualified a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.reassigned` | 1 | Open leads were moved to another person. | `count` (integer) |
| `lead.referred` | 1 | A lead referred by a merchant came in. | `changed` (string[]), `actor_id` (uuid) |
| `lead.released` | 1 | Released a lead. | `changed` (string[]), `actor_id` (uuid) |
| `lead.repeat_request` | 1 | Another web request came in from the same business. | `changed` (string[]), `actor_id` (uuid) |
| `lead.unlinked_from_account` | 1 | Unlinked a lead from a merchant. | `changed` (string[]), `actor_id` (uuid) |
| `lead.updated` | 1 | Fixed a lead’s type or role. | `changed` (string[]), `actor_id` (uuid) |
| `loss_reason.created` | 1 | Added a loss reason. | `changed` (string[]), `actor_id` (uuid) |
| `loss_reason.updated` | 1 | Edited a loss reason. | `changed` (string[]), `actor_id` (uuid) |
| `market.created` | 1 | Added a market. | `changed` (string[]), `actor_id` (uuid) |
| `market.holiday_added` | 1 | Added a holiday. | `changed` (string[]), `actor_id` (uuid) |
| `market.holiday_removed` | 1 | Removed a holiday. | `changed` (string[]), `actor_id` (uuid) |
| `market.updated` | 1 | Edited a market. | `changed` (string[]), `actor_id` (uuid) |
| `membership.areas_changed` | 1 | Changed which parts a person administers. | `changed` (string[]), `actor_id` (uuid) |
| `membership.ended` | 1 | Removed access. | `changed` (string[]), `actor_id` (uuid) |
| `membership.ended_by_directory` | 1 | Removed access because the Google account no longer exists. | `changed` (string[]), `actor_id` (uuid) |
| `membership.entity_changed` | 1 | Limited an access to a legal entity. | `changed` (string[]), `actor_id` (uuid) |
| `membership.expiry_changed` | 1 | Changed when an access expires. | `changed` (string[]), `actor_id` (uuid) |
| `membership.granted` | 1 | Granted access. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.approved` | 1 | Approved an enrollment file. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.assigned` | 1 | Took or assigned a control desk file. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.auto_approved` | 1 | Prepaid enrollment file approved by rule. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.document_received` | 1 | Marked an enrollment document as received. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.document_reviewed` | 1 | Validated or rejected an enrollment document. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.opened` | 1 | Opened an enrollment file. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.returned` | 1 | Returned an enrollment file with a reason. | `changed` (string[]), `actor_id` (uuid) |
| `onboarding.submitted` | 1 | Sent an enrollment file to the control desk. | `changed` (string[]), `actor_id` (uuid) |
| `order.received` | 1 | Received an order in Operations. | `changed` (string[]), `actor_id` (uuid) |
| `order.sent_to_ops` | 1 | Sent an order to Operations. | `changed` (string[]), `actor_id` (uuid) |
| `partner.registered` | 1 | Registered an account as a partner. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.catalog_created` | 1 | Added an item to an Operations catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.catalog_updated` | 1 | Edited an item in an Operations catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.configured` | 1 | Changed a pipeline’s closing rule. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.created` | 1 | Created a pipeline. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.ops_configured` | 1 | Changed a pipeline’s order and Operations settings. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.product_created` | 1 | Added a product to the catalog. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.product_updated` | 1 | Edited a catalog product. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.stage_times` | 1 | Changed a stage’s time goal. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.step_saved` | 1 | Changed who takes a stage step and what it requires. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.visit_reason_created` | 1 | Added a visit purpose. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.visit_reason_updated` | 1 | Edited a visit purpose. | `changed` (string[]), `actor_id` (uuid) |
| `pipeline.win_rule_set` | 1 | Changed a pipeline’s win rule. | `changed` (string[]), `actor_id` (uuid) |
| `plan.created` | 1 | Created an integration plan. | `changed` (string[]), `actor_id` (uuid) |
| `plan.milestone_added` | 1 | Added a milestone to the integration plan. | `changed` (string[]), `actor_id` (uuid) |
| `plan.milestone_updated` | 1 | Changed an integration plan milestone. | `changed` (string[]), `actor_id` (uuid) |
| `plan.set` | 1 | Set a person’s monthly target. | `changed` (string[]), `actor_id` (uuid) |
| `plan.shared` | 1 | Requested client access to the integration plan. | `changed` (string[]), `actor_id` (uuid) |
| `portfolio.plan_applied` | 1 | Applied a reassignment plan. | `changed` (string[]), `actor_id` (uuid) |
| `portfolio.plan_discarded` | 1 | Discarded a reassignment plan. | `changed` (string[]), `actor_id` (uuid) |
| `portfolio.plan_drafted` | 1 | Saved a draft reassignment plan. | `changed` (string[]), `actor_id` (uuid) |
| `process.enrolled` | 1 | Put a merchant on a process list. | `changed` (string[]), `actor_id` (uuid) |
| `process.list_created` | 1 | Created a process list. | `changed` (string[]), `actor_id` (uuid) |
| `process.list_toggled` | 1 | Turned a process list on or off. | `changed` (string[]), `actor_id` (uuid) |
| `process.status_changed` | 1 | Changed a merchant’s status on a process list. | `changed` (string[]), `actor_id` (uuid) |
| `product.provider_set` | 1 | Changed a product’s provider. | `changed` (string[]), `actor_id` (uuid) |
| `provider.sla_set` | 1 | Changed a provider’s response deadline. | `changed` (string[]), `actor_id` (uuid) |
| `routing.assignment_rule_changed` | 1 | Changed the cap of an assignment rule. | `changed` (string[]), `actor_id` (uuid) |
| `routing.assignment_rule_created` | 1 | Created a lead assignment rule. | `changed` (string[]), `actor_id` (uuid) |
| `routing.assignment_rule_edited` | 1 | Changed the name or condition of an assignment rule. | `changed` (string[]), `actor_id` (uuid) |
| `routing.assignment_rule_moved` | 1 | Changed the order of an assignment rule. | `changed` (string[]), `actor_id` (uuid) |
| `routing.assignment_rule_toggled` | 1 | Turned a lead assignment rule on or off. | `changed` (string[]), `actor_id` (uuid) |
| `routing.escalation_updated` | 1 | Changed a market’s first-contact escalation. | `changed` (string[]), `actor_id` (uuid) |
| `routing.hours_updated` | 1 | Changed a market’s business hours. | `changed` (string[]), `actor_id` (uuid) |
| `routing.members_changed` | 1 | Changed a lead rotation. | `changed` (string[]), `actor_id` (uuid) |
| `routing.rule_created` | 1 | Created a lead rotation. | `changed` (string[]), `actor_id` (uuid) |
| `routing.rule_toggled` | 1 | Turned a lead rotation on or off. | `changed` (string[]), `actor_id` (uuid) |
| `routing.target_set` | 1 | Changed a rotation’s response target. | `changed` (string[]), `actor_id` (uuid) |
| `seller.profile_set` | 1 | Changed a seller’s profile (opens or keeps accounts). | `changed` (string[]), `actor_id` (uuid) |
| `stage.archived` | 1 | Archived a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.condition_set` | 1 | Changed the condition of a stage requirement. | `changed` (string[]), `actor_id` (uuid) |
| `stage.created` | 1 | Added a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.reordered` | 1 | Reordered a stage. | `changed` (string[]), `actor_id` (uuid) |
| `stage.updated` | 1 | Edited a stage. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.added` | 1 | Added a street seller. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.ended` | 1 | Removed a street seller. | `changed` (string[]), `actor_id` (uuid) |
| `street_seller.updated` | 1 | Changed who a street seller reports to. | `changed` (string[]), `actor_id` (uuid) |
| `taxid.captured` | 1 | Captured a tax ID. | `changed` (string[]), `actor_id` (uuid) |
| `taxid.reviewed` | 1 | Reviewed a tax ID. | `changed` (string[]), `actor_id` (uuid) |
| `team.agency_created` | 1 | Added an agency or partner that recruits stores. | `changed` (string[]), `actor_id` (uuid) |
| `team.agency_restored` | 1 | Restored an agency or partner. | `changed` (string[]), `actor_id` (uuid) |
| `team.agency_retired` | 1 | Retired an agency or partner. | `changed` (string[]), `actor_id` (uuid) |
| `team.created` | 1 | Created a team. | `changed` (string[]), `actor_id` (uuid) |
| `team.parent_changed` | 1 | Changed which team a team reports to. | `changed` (string[]), `actor_id` (uuid) |
| `terms.versioned` | 1 | Saved a version of the commercial terms. | `changed` (string[]), `actor_id` (uuid) |
| `territory.archived` | 1 | Archived a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.created` | 1 | Created a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.manager_set` | 1 | Changed a territory’s manager. | `changed` (string[]), `actor_id` (uuid) |
| `territory.owner_set` | 1 | Set who owns a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.renamed` | 1 | Renamed a territory. | `changed` (string[]), `actor_id` (uuid) |
| `territory.restored` | 1 | Restored a territory. | `changed` (string[]), `actor_id` (uuid) |
| `training.cancelled` | 1 | Cancelled a training. | `changed` (string[]), `actor_id` (uuid) |
| `training.done` | 1 | Marked a training as done. | `changed` (string[]), `actor_id` (uuid) |
| `training.no_show` | 1 | Recorded that the dealer missed the training. | `changed` (string[]), `actor_id` (uuid) |
| `training.scheduled` | 1 | Scheduled a training. | `changed` (string[]), `actor_id` (uuid) |
| `user.bootstrap_admin` | 1 | Got Administration from the environment’s bootstrap list. | `changed` (string[]), `actor_id` (uuid) |
| `user.entity_set` | 1 | Changed a person’s legal entity. | `changed` (string[]), `actor_id` (uuid) |
| `user.territories_changed` | 1 | Changed a person’s territories. | `changed` (string[]), `actor_id` (uuid) |
| `whatsapp.account_saved` | 1 | Saved a market’s WhatsApp number. | `changed` (string[]), `actor_id` (uuid) |
| `whatsapp.rate_saved` | 1 | Loaded a WhatsApp cost per message. | `changed` (string[]), `actor_id` (uuid) |
| `whatsapp.template_saved` | 1 | Saved a WhatsApp template. | `changed` (string[]), `actor_id` (uuid) |
| `whatsapp.template_status` | 1 | Changed a WhatsApp template’s status. | `changed` (string[]), `actor_id` (uuid) |

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
| `access_review.closed` | Closed an access review | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `access_review.decided` | Decided an access in the review | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `access_review.opened` | Opened an access review | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `activity.notice_seen` | Marked a notice as seen | It is a notice between people inside CONTIGO, not a change to the record. |
| `activity.notice_sent` | Notified someone from a note | It is a notice between people inside CONTIGO, not a change to the record. |
| `announcement.acknowledged` | Acknowledged an announcement | It is a notice between people inside CONTIGO, not a change to the record. |
| `announcement.published` | Published an announcement | It is a notice between people inside CONTIGO, not a change to the record. |
| `announcement.read` | Read an announcement | It is a notice between people inside CONTIGO, not a change to the record. |
| `announcement.updated` | Published a new version of an announcement | It is a notice between people inside CONTIGO, not a change to the record. |
| `announcement.withdrawn` | Withdrew an announcement | It is a notice between people inside CONTIGO, not a change to the record. |
| `api_client.created` | Created an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `api_client.revoked` | Revoked an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `api_client.rotated` | Rotated an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `api_client.updated` | Changed the owner or expiry of an API key | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `automation.notified` | An automation notified a person | It is a notice between people inside CONTIGO, not a change to the record. |
| `automation.owner_set` | Confirmed who answers for an automation | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `automation.task_created` | An automation created a task | It is a notice between people inside CONTIGO, not a change to the record. |
| `care.alert_dismissed` | Dismissed a merchant alert | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.alert_done` | Handled a merchant alert | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.alerts_run` | Evaluated a market’s alerts | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_dismissed` | Dismissed an expansion opportunity | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_lost` | Closed an expansion opportunity: the merchant declined | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_rule_saved` | Changed an expansion rule | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_run` | Looked for expansion opportunities in a market | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_taken` | Took an expansion opportunity | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.expansion_won` | Closed an expansion opportunity: the merchant accepted | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.feedback_added` | Logged product feedback | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.feedback_status_set` | Answered product feedback | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.handoff_acknowledged` | Acknowledged a handoff | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.handoff_checked` | Ticked an item on a handoff list | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.handoff_created` | Handed a merchant off to another team | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.handoff_returned` | Sent a handoff back | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.health_published` | Published the health score to the team | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.health_run` | Calculated a market’s health score | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.health_unpublished` | Stopped publishing the health score | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.health_validated` | Validated the health score against what happened | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.health_weights_saved` | Changed the health score weights | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.lifecycle_run` | Recalculated a market’s lifecycle stages | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.manager_changed` | Recorded a manager change | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.plan_saved` | Changed an account plan | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.playbook_saved` | Changed a playbook | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.product_line_set` | Changed a merchant’s product line | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.relationship_saved` | Changed an account’s relationship by product | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.review_added` | Recorded an account review with its minutes | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.settings_saved` | Changed a market’s alert settings | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.stage_set` | Changed a merchant’s lifecycle stage by hand | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.tier_rules_saved` | Changed the service model rules | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.tiers_run` | Recalculated a market’s service model | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.training_recorded` | Recorded a training completion | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `care.window_set` | Changed a lifecycle window | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `champion.reviewed` | Recorded the monthly review with a champion | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `champion.set` | Changed a team’s champion | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `change.reason_added` | Recorded why a configuration change was made | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `comms.saved` | Changed a market’s notice settings | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `component.owners_set` | Changed who answers for a component | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `config_request.created` | Asked for a configuration change | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `config_request.decided` | Decided a configuration request | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `consent.opt_out_lifted` | Lifted an opt-out | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `consent.opted_out` | Recorded an opt-out | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `consent.recorded` | Recorded a consent | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `consent.revoked` | Withdrew a consent | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `cost.added` | Loaded a cost | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `cost.voided` | Voided a cost | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `csv_import.completed` | Imported a file | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `csv_import.undone` | Undid an import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `deployment.recorded` | Recorded a deployment | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `document.emailed` | Emailed a document | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `document.generated` | Generated a document | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `duplicate.bypass_reviewed` | Reviewed a skipped duplicate warning | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `duplicate.bypassed` | Created a merchant despite a duplicate warning, with a reason | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `duplicate.dismissed` | Dismissed a pair of possible duplicates | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `duplicate.scanned` | Scanned a market for duplicates | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `event_delivery.resent` | Resent an event to a subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.created` | Added an event subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.secret_rotated` | Rotated an event subscriber’s secret | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `event_subscriber.status_changed` | Paused, resumed or removed an event subscriber | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `export.alert` | Went over the daily export threshold | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `ficha.layout_set` | Changed the top facts of the merchant page for a role | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `field_incident.closed` | Closed a field incident | It is a confidential field record with restricted access: it is logged and not published to other systems. |
| `field_incident.reported` | Reported a field incident | It is a confidential field record with restricted access: it is logged and not published to other systems. |
| `field_incident.taken` | Took a field incident | It is a confidential field record with restricted access: it is logged and not published to other systems. |
| `field_incident.viewed` | Opened a field incident | It is a confidential field record with restricted access: it is logged and not published to other systems. |
| `field_section.created` | Added a field section | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `funding.simulated` | Loaded a simulated funding value | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `funnel.setting_changed` | Changed or confirmed a pipeline setting | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `goal.updated` | Changed a goal | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `help.lesson_saved` | Changed a screen’s lesson | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `ia.draft_approved` | Approved a task draft | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.draft_rejected` | Rejected a task draft, with a reason | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.eval_case_added` | Added a case to the evaluation | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.eval_run` | Ran a feature’s evaluation | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.holdout_added` | Made a territory a control group | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.holdout_removed` | Removed a territory from the control group | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.lead_classified` | Confirmed a lead’s classification | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.lead_weights_changed` | Changed the lead scoring weights | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.mcp_read` | An agent read data through the MCP server | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.settings_changed` | Changed a market’s assistance level | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `ia.spot_checked` | Logged the weekly review of the assistance | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `import.cancelled` | Stopped the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.completed` | The Pipedrive import finished | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.conflict_kept` | Kept the CONTIGO value in a clash with Pipedrive | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.conflict_taken` | Used the Pipedrive value in a clash | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.cutover_updated` | Changed the Pipedrive coexistence of a market | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.raw_purged` | Emptied the raw Pipedrive copy | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.resumed` | Resumed the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `import.started` | Started the Pipedrive import | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `inbound.replayed` | Reprocessed a held message | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `incident.opened` | Opened an incident | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `incident.updated` | Updated an incident | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `integration.dead_letter` | A Sales App message went to dead letters | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.intake_held` | Held a form submission that could not be saved | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.intake_retried` | Retried a held form submission by hand | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.merchant_approved` | A merchant’s approval arrived | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.metrics_loaded` | The daily sales file was loaded | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.metrics_quarantined` | Sales file set aside for review | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.onboarding_received` | A merchant’s onboarding arrived from the Sales App | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.route_checkin` | Received a route tool check-in | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.simulated` | Tested an integration from Administration | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.store_sales_loaded` | Loaded the store sales figures | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `integration.visit_received` | A Sales App visit came in | It is data arriving from another system: the sender already knows. The change it causes (for instance, a deal won) does emit its own event. |
| `job.run_manual` | Ran a scheduled job by hand | It is a manual run of a scheduled job: whatever the job changes emits its own event; the run itself does not. |
| `load.configured` | Changed a load’s owner or schedule | It is a manual run of a scheduled job: whatever the job changes emits its own event; the run itself does not. |
| `load.window_set` | Changed a market’s no-load window | It is a manual run of a scheduled job: whatever the job changes emits its own event; the run itself does not. |
| `maintenance.closed` | Closed a maintenance window | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `maintenance.scheduled` | Scheduled a maintenance window | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `market.reset_test` | Wiped and reloaded a test market | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `material.removed` | Removed a training material | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `material.saved` | Saved a training material | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `metric.owner_set` | Changed who answers for a metric | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `network_load.business_released` | Gave the business release for an acquired network | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `network_load.legal_released` | Gave the legal release for an acquired network | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `network_load.promoted` | Moved a batch of an acquired network into the portfolio | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `network_load.rolled_back` | Rolled back a batch of an acquired network | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `network_load.staged` | Loaded an acquired network into its separate space | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `notice.all_seen` | Marked all notices as read | It is a notice between people inside CONTIGO, not a change to the record. |
| `notice.prefs_saved` | Changed notice preferences | It is a notice between people inside CONTIGO, not a change to the record. |
| `objective.set` | Set a service or recovery objective | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `onboarding.document_opened` | Asked to open an enrollment document | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `partner.crossmatch_run` | Ran the partner base cross-match | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `partner.invite_queued` | Queued an external user invitation | It is a notice between people inside CONTIGO, not a change to the record. |
| `partner_tier.material_added` | Added enablement material to a tier | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `partner_tier.recalculated` | Recalculated partner tiers | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `partner_tier.saved` | Saved a partner tier and its criteria | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `partner_token.created` | Created a partner read token | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `partner_token.revoked` | Revoked a partner read token | It is the integrations’ own plumbing (keys, subscribers, resends): publishing it would be an event about events. |
| `pipedrive.backup_downloaded` | Downloaded the Pipedrive backup | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `quality.rule_updated` | Edited a data quality rule | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `quality.snapshot_saved` | Saved today’s data quality snapshot | It is internal data-quality work (queues, measurements, duplicate reviews): when it ends in a change to the record, such as a merge or an edit, that change emits its own event. |
| `recommendation.accepted` | Accepted a suggestion and set the task with a date | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `recommendation.dismissed` | Dismissed a suggestion, with a reason | It is internal assistance work (suggestions, drafts, weights, evaluation): the resulting task, if any, emits its own event. |
| `reconciliation.ran` | Reconciled with the sales file | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `release.announced` | Announced a release | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `release.created` | Created a release | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `release.item_checked` | Marked a go-live checklist item as done | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `release.released` | Marked a release as released | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `report.answered` | Answered a team report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `report.created` | Reported a problem or asked for something | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `report.exported` | Exported a report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `report.taken` | Started reviewing a team report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `restore_test.recorded` | Recorded a restore test | It is a record of how CONTIGO is run (service, releases, costs, requests): it is logged and changes no merchants, leads or deals. |
| `retention.applied` | Applied a retention rule | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `retention.rule_changed` | Changed a retention rule | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `rollout.key_person_added` | Added a key person to the rollout | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `rollout.key_person_removed` | Removed a key person from the rollout | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `rollout.leaders_first_set` | Changed the leaders-first rule | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `rollout.step_set` | Changed a market rollout step | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `rollout.team_opened` | Opened the market to the field team | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `routing.suggestion_decided` | Decided a saturated store suggestion | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `rules.evaluated` | Ran the rules by hand | Running the rules opens or closes internal notices; it changes no merchants, leads or deals. |
| `saved_report.deleted` | Deleted a saved report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_report.delivered` | Delivered a scheduled report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_report.saved` | Saved a report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_report.scheduled` | Scheduled a report | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_view.deleted` | Deleted a view | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_view.pinned` | Pinned a view as a queue | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_view.saved` | Saved a view | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `saved_view.unpinned` | Removed a queue from the menu | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `seat.approved` | Recorded who approved a seat | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `secret.updated` | Updated a connection’s inventory entry | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `security.alert_acknowledged` | Reviewed a security alert | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `security.due_days_changed` | Changed the response period for data requests | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `security.thresholds_changed` | Changed the alert thresholds | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `sensitive.revealed` | Revealed restricted data | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `sensitive.updated` | Saved restricted data | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `sensitive_field.created` | Created a restricted field | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `sensitive_field.updated` | Changed who sees a restricted field | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `session.ended` | Signed out | Sign-ins and sign-outs do not change business data. |
| `session.started` | Signed in | Sign-ins and sign-outs do not change business data. |
| `sheet.migrated_loaded` | Loaded migrated stores from the sheet | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `sheet.visits_loaded` | Loaded visits from the sheet | It is a historical or file load: each record created emits its own event; the run itself does not. |
| `snapshot.taken` | Took the daily snapshot | It is a read leaving CONTIGO or an internal team report: it is logged, it changes no records. |
| `subject_request.anonymized` | Anonymized a person’s data | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `subject_request.closed` | Closed a personal data request | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `subject_request.created` | Recorded a person’s request about their data | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `subject_request.exported` | Pulled a person’s data to hand it over | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `subject_request.updated` | Updated a personal data request | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `template.saved` | Saved a new version of a template | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `threshold.changed` | Changed a threshold (new version) | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `transition.activated` | Turned a proposed stage step on or off | It is internal CONTIGO setup (metrics, notice templates, help, a market rollout): it changes no merchants, leads or deals. |
| `view_as.ended` | Stopped viewing as someone else | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
| `view_as.started` | Started viewing CONTIGO as someone else | It is a security or privacy control (restricted data, consent, data subject requests, access reviews, view as, keys): it is logged. Publishing it would take control or personal data out of CONTIGO. |
