import { expect, type Page } from '@playwright/test'

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
