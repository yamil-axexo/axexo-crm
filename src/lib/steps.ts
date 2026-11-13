// PIPE-02: el mensaje después de pedir un cambio de etapa. Si el paso pide aprobación, el negocio no se movió todavía.
export type Moved = { status: 'moved' } | { status: 'pending'; approver: string }

export const moveMessage = (r: Moved | void, moved: [es: string, en: string]): [es: string, en: string] =>
  r && r.status === 'pending'
    ? [`Queda esperando la aprobación de ${r.approver}. El negocio se mueve cuando lo apruebe.`, `Waiting for approval from ${r.approver}. The deal moves once it is approved.`]
    : moved
