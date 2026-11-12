import 'server-only'
import { parseDomains, validDomain } from '@/lib/domains'
import { z } from 'zod'

// PORT-05: variables de entorno tipadas y validadas al arrancar. Nada sensible lleva NEXT_PUBLIC_ (SEC-03).
/**
 * Una URL mal formada (por ejemplo, una contraseña con # o / sin codificar) hace que el driver tome parte de la
 * contraseña como host y la imprima en el error de conexión. Se valida aquí para que nunca llegue al driver (OBS-01).
 * El mensaje de error no incluye el valor.
 */
export function validDatabaseUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'postgres:' || u.protocol === 'postgresql:') &&
      u.username !== '' &&
      u.hash === '' &&
      /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$|^\[[0-9a-f:]+\]$/i.test(u.hostname) &&
      (u.hostname.includes('.') || u.hostname === 'localhost' || u.hostname.startsWith('[')) &&
      (u.port === '' || /^\d{2,5}$/.test(u.port)) &&
      u.pathname.length > 1
    )
  } catch {
    return false
  }
}

const schema = z
  .object({
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required').refine(validDatabaseUrl, 'DATABASE_URL is not a well-formed postgres URL: it needs user, password, host, port and database, in that order'),
    // Dominios de la organización de Google Workspace que pueden entrar, separados por coma (AUTHZ-01).
    AUTH_ALLOWED_DOMAINS: z
      .string()
      .default('axexo.com,emida.com,emida.net')
      .transform(parseDomains)
      .refine((list) => list.length > 0 && list.every(validDomain), 'AUTH_ALLOWED_DOMAINS must be a comma-separated list of domains'),
    SUPABASE_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional().or(z.literal('').transform(() => undefined)),
    BOOTSTRAP_ADMIN_EMAILS: z.string().default(''),
    DEMO_PERSONAS: z.enum(['0', '1']).default('0'),
    // Migración desde Pipedrive: el token solo vive en el servidor (SEC-03) y solo sale hacia la API de Pipedrive.
    PIPEDRIVE_API_TOKEN: z.string().optional().or(z.literal('').transform(() => undefined)),
    PIPEDRIVE_API_BASE: z.string().url().default('https://api.pipedrive.com'),
  })
  .superRefine((v, ctx) => {
    if (v.APP_ENV === 'production' && v.DEMO_PERSONAS === '1') {
      ctx.addIssue({ code: 'custom', message: 'DEMO_PERSONAS cannot be enabled in production', path: ['DEMO_PERSONAS'] })
    }
    // El token nunca viaja a un host que no sea Pipedrive; el host local solo existe para las pruebas.
    const host = new URL(v.PIPEDRIVE_API_BASE).hostname
    const isPipedrive = host === 'pipedrive.com' || host.endsWith('.pipedrive.com')
    const isLocalTest = v.APP_ENV !== 'production' && v.APP_ENV !== 'staging' && (host === '127.0.0.1' || host === 'localhost')
    if (!isPipedrive && !isLocalTest) {
      ctx.addIssue({ code: 'custom', message: 'PIPEDRIVE_API_BASE must be a pipedrive.com host', path: ['PIPEDRIVE_API_BASE'] })
    }
    if (v.APP_ENV === 'production' && !(v.SUPABASE_URL && v.SUPABASE_PUBLISHABLE_KEY)) {
      ctx.addIssue({ code: 'custom', message: 'an identity provider is required in production', path: ['SUPABASE_URL'] })
    }
  })

export type Env = z.infer<typeof schema>

let cached: Env | undefined
export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment:\n${lines.join('\n')}`)
  }
  cached = parsed.data
  return cached
}

export const ssoEnabled = () => Boolean(env().SUPABASE_URL && env().SUPABASE_PUBLISHABLE_KEY)
export const personasEnabled = () => env().DEMO_PERSONAS === '1' && env().APP_ENV !== 'production'
export const bootstrapAdmins = () =>
  env()
    .BOOTSTRAP_ADMIN_EMAILS.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
