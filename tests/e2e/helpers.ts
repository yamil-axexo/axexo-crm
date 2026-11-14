import { expect, type Page } from '@playwright/test'
import postgres from 'postgres'

/** Entra como una persona sintética desde la pantalla de login (solo existe fuera de producción). */
/**
 * Cada rol aterriza en su pantalla: ventas y supervisión en Hoy; Operaciones en su cola; quien lidera el mercado en
 * Mi equipo; leadership en el Panel del LT y administración en Administración. Las pruebas que ya existían parten de Hoy, así que
 * por defecto se navega ahí después de entrar; con `stay` la prueba se queda donde la persona aterrizó.
 */
const ENGLISH = new Set(['jade.kim', 'kira.dunn', 'robert.hale', 'sam.ortiz', 'tom.reyes'])

export async function loginAs(page: Page, persona: string, opts: { stay?: boolean; /** Deja el idioma que hereda del navegador. */ browserLocale?: boolean } = {}) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.getByTestId(`persona-${persona}`).click()
  await expect(page).toHaveURL(/\/(hoy|operaciones|supervisor|panel-lt|admin)$/)
  // Sin elección previa la app hereda el idioma del navegador de la prueba (es-MX). Las personas de US ya eligieron inglés:
  // así cada prueba ve a la persona en su idioma, como antes. Quien prueba la herencia entra sin este helper.
  if (!opts.browserLocale && ENGLISH.has(persona)) {
    await page.context().addCookies([{ name: 'contigo_locale', value: 'en', url: page.url() }])
    await page.reload()
  }
  if (!opts.stay && !/\/hoy$/.test(page.url())) {
    await page.goto('/hoy')
    await expect(page).toHaveURL(/\/hoy$/)
  }
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

/** Cambia de pestaña en la ficha del comercio (Hilo, Árbol, Datos). */
export async function fichaTab(page: Page, tab: 'hilo' | 'arbol' | 'datos') {
  await page.getByTestId(`tab-${tab}`).click()
  await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute('aria-current', 'page')
}

/** El ID del comercio cuya ficha está abierta, sea como panel sobre la lista (?ficha=) o a pantalla completa (/comercios/<id>). */
export async function fichaId(page: Page): Promise<string> {
  await expect(page.getByTestId('ficha')).toBeVisible()
  const url = new URL(page.url())
  return url.searchParams.get('ficha') ?? url.pathname.split('/').pop()!
}
