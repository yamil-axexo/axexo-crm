/**
 * Salud del comercio (handoff, sección 5): una palabra y un punto, nunca solo color.
 * Sale de la etapa de vida que mantiene S5 y de si tiene un negocio abierto.
 */
export type Health = 'active' | 'idle' | 'risk' | 'new'

export const healthOf = (lifecycle: string, hasOpenDeal: boolean): Health =>
  lifecycle === 'active' ? 'active' : lifecycle === 'at_risk' || lifecycle === 'inactive' || lifecycle === 'churned' ? 'risk' : lifecycle === 'onboarding' || hasOpenDeal ? 'idle' : 'new'

export const HEALTH_DOT: Record<Health, string> = {
  active: 'var(--cg-health-active)',
  idle: 'var(--cg-health-idle)',
  risk: 'var(--cg-health-risk)',
  new: 'var(--cg-health-new)',
}
