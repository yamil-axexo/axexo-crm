import { redirect } from 'next/navigation'
import { getCtx } from '@/server/context'
import { opsVoice } from '@/server/sheet'

export default async function Home() {
  const ctx = await getCtx()
  redirect(!ctx ? '/login' : opsVoice(ctx) ? '/operaciones' : '/hoy')
}
