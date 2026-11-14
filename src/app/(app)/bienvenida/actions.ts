'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireCtx } from '@/server/context'
import { setOnboardingHidden, toggleStep } from '@/domain/onboarding'

const refresh = () => {
  revalidatePath('/bienvenida')
  revalidatePath('/hoy')
}

export async function toggleStepAction(fd: FormData): Promise<void> {
  const ctx = await requireCtx()
  await toggleStep(ctx, String(fd.get('key') ?? ''))
  refresh()
}

export async function hideOnboardingAction(fd: FormData): Promise<void> {
  const ctx = await requireCtx()
  await setOnboardingHidden(ctx, true)
  refresh()
  if (fd.get('then') === 'hoy') redirect('/hoy')
}

export async function showOnboardingAction(): Promise<void> {
  const ctx = await requireCtx()
  await setOnboardingHidden(ctx, false)
  refresh()
}
