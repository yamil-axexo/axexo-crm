'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { VIEW_AS_COOKIE, sessionUserId } from '@/server/context'
import { withoutUser } from '@/server/db'

/** Termina "ver como": no pasa por runAction porque en ese modo toda acción está cortada; esta solo cierra la sesión de ver como. */
export async function stopViewAsAction(): Promise<void> {
  const jar = await cookies()
  const id = jar.get(VIEW_AS_COOKIE)?.value
  const actor = await sessionUserId()
  if (id && actor && /^[0-9a-f-]{36}$/i.test(id)) await withoutUser((tx) => tx`select app.view_as_end(${id}, ${actor})`)
  jar.delete(VIEW_AS_COOKIE)
  revalidatePath('/', 'layout')
  redirect('/admin/seguridad?s=accesos')
}
