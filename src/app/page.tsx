import { redirect } from 'next/navigation'
import { getCtx } from '@/server/context'
import { homePath } from '@/domain/policy'

export default async function Home() {
  const ctx = await getCtx()
  redirect(ctx ? homePath(ctx.memberships) : '/login')
}
