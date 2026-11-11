import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'

/** Entra como una persona sintética desde la pantalla de login (solo existe fuera de producción). */
export async function loginAs(page: Page, persona: string) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId(`persona-${persona}`).click()
  await expect(page).toHaveURL(/\/hoy$/)
}

export const pageErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

/** Abre el menú de la cuenta (avatar): ahí viven Mi equipo, Panel del LT, Administración y Salir. */
export async function openMenu(page: Page) {
  const panel = page.getByTestId('me-panel')
  if (!(await panel.isVisible())) await page.getByTestId('me-menu').click()
  await expect(panel).toBeVisible()
}

/** Los tres anchos del handoff: desktop (>= 1200), tablet (768 a 1199) y móvil (< 768). */
export const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'movil', width: 390, height: 844 },
] as const

/** Conexión directa a la base de pruebas, solo para preparar un caso que la interfaz no deja crear (por ejemplo, una tarea vencida). */
export const testDb = () => postgres(process.env.MIGRATION_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/contigo_test', { max: 1, onnotice: () => {} })
