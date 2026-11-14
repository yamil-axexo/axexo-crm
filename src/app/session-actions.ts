'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSession, destroySession, LOCALE_COOKIE } from '@/server/context'
import { personasEnabled } from '@/env'
import { firstStop } from '@/server/first-stop'

/** Solo staging y desarrollo: entra como una persona sintética. La base lo vuelve a validar (app.session_create). */
export async function loginAsPersona(formData: FormData): Promise<void> {
  if (!personasEnabled()) redirect('/login?error=disabled')
  const id = z.guid().safeParse(formData.get('user_id'))
  if (!id.success) redirect('/login?error=invalid')
  let next: string
  try {
    await createSession(id.data, 'persona')
    next = await firstStop(id.data)
  } catch {
    redirect('/login?error=invalid')
  }
  redirect(next)
}

export async function logout(): Promise<void> {
  await destroySession()
  redirect('/login')
}

export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get('locale') === 'en' ? 'en' : 'es'
  ;(await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
  revalidatePath('/', 'layout')
}
