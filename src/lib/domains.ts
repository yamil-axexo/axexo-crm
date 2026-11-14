// AUTHZ-01: dominios de correo que pueden entrar. Son los dominios de la organización de Google Workspace
// (axexo.com y los que vienen de EMIDA). La comparación es exacta sobre lo que va después de la última "@":
// "persona@axexo.com.otro.com" o "persona@noaxexo.com" no pasan.
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

export function parseDomains(csv: string): string[] {
  return [...new Set(csv.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean))]
}

export const validDomain = (d: string) => DOMAIN.test(d)

export function emailInDomains(email: string, domains: readonly string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  return domains.includes(email.slice(at + 1).toLowerCase())
}

/** "axexo.com, emida.com o emida.net" */
export function domainList(domains: readonly string[], or: string): string {
  if (domains.length <= 1) return domains[0] ?? ''
  return `${domains.slice(0, -1).join(', ')} ${or} ${domains[domains.length - 1]}`
}
