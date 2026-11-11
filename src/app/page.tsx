import { redirect } from 'next/navigation'
import { getCtx } from '@/server/context'

export default async function Home() {
  redirect((await getCtx()) ? '/hoy' : '/login')
}
