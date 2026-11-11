-- 0006_today_queue: Hoy es una cola de trabajo y completar un registro guarda cómo fue.
-- outcome: el resultado que la persona elige al completar (¿Cómo te fue?). Nulo en lo anterior a esta migración
-- y en lo que llega de otras fuentes (importación, reglas).
alter table crm.activities
  add column outcome text check (outcome is null or outcome in ('reached', 'no_answer', 'later', 'done'));

-- La cola de Hoy lee lo abierto de una persona por fecha: el índice parcial existente (owner_id, due_at) ya lo cubre.
-- Los leads sin primer contacto se buscan por dueño.
create index leads_waiting_idx on crm.leads (owner_id, sla_due_at) where status = 'new' and first_touch_at is null;
