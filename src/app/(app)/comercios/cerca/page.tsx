import Link from 'next/link'
import { requireCtx } from '@/server/context'
import { locatedCount } from '@/dal/markets'
import { PageHeader } from '@/ui/kit'
import { NearMe } from '@/ui/geo'
import { LIFECYCLE } from '@/lib/labels'
import { num } from '@/lib/format'
import { nearMeAction } from '../mercados-actions'

/**
 * Cerca de mí (MULTI-04): los comercios del alcance de la persona, por distancia. La ubicación sale del teléfono con su
 * permiso, se usa para esta consulta y no se guarda. La distancia se calcula en la base, sin proveedor de mapas.
 */
export default async function NearPage() {
  const ctx = await requireCtx()
  const { t, locale } = ctx
  const c = await locatedCount(ctx)
  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader
        title={t('Cerca de mí', 'Near me')}
        desc={t('Tus comercios más cercanos, del más próximo al más lejano. Tu ubicación se usa para esta búsqueda y no se guarda.', 'Your nearest merchants, closest first. Your location is used for this search and is not stored.')}
        actions={<Link href="/comercios" className="inline-flex min-h-11 items-center text-[14px] font-medium text-blue-text underline" data-testid="near-back">{t('Volver a la lista', 'Back to the list')}</Link>}
      />
      <p className="mb-5 text-[13.5px] text-muted-2" data-testid="near-coverage">
        {c.located === 0
          ? t('Todavía ningún comercio de tu lista tiene ubicación. Se guarda desde la ficha de cada comercio, en Datos, estando en el lugar.', 'No merchant on your list has a location yet. It is saved from each merchant’s page, under Details, while on site.')
          : t(`${num(c.located, locale)} de ${num(c.total, locale)} comercios de tu lista tienen ubicación. Los demás no aparecen aquí hasta que alguien la guarde desde su ficha.`, `${num(c.located, locale)} of ${num(c.total, locale)} merchants on your list have a location. The rest do not show here until someone saves it from their page.`)}
      </p>
      <NearMe
        action={nearMeAction}
        locale={locale}
        radii={[{ value: 500, label: t('500 metros', '500 meters') }, { value: 2000, label: t('2 kilómetros', '2 kilometers') }, { value: 10000, label: t('10 kilómetros', '10 kilometers') }]}
        labels={{
          search: t('Buscar cerca de mí', 'Search near me'), locating: t('Buscando', 'Searching'), radius: t('Hasta', 'Within'),
          denied: t('El navegador no dio permiso de ubicación. Actívalo en los ajustes del navegador para este sitio y vuelve a intentar.', 'The browser did not allow location. Turn it on in the browser settings for this site and try again.'),
          unavailable: t('No se pudo leer tu ubicación. Revisa que el teléfono tenga la ubicación encendida e intenta otra vez.', 'Your location could not be read. Check that location is on in your phone and try again.'),
          failed: t('No pudimos buscar. Intenta otra vez.', 'We could not search. Try again.'),
          empty: t('No hay comercios con ubicación a esa distancia.', 'There are no merchants with a location within that distance.'),
          emptyHint: t('Prueba con una distancia mayor. Solo aparecen los comercios que ya tienen ubicación guardada.', 'Try a longer distance. Only merchants with a saved location show up.'),
          foundOne: t('1 comercio, del más cercano al más lejano', '1 merchant, closest first'), foundMany: t('{n} comercios, del más cercano al más lejano', '{n} merchants, closest first'),
          noOwner: t('Sin asignar', 'No owner'), call: t('Llamar', 'Call'),
          lifecycle: Object.fromEntries(Object.entries(LIFECYCLE).map(([k, v]) => [k, t(v.label[0], v.label[1])])),
        }}
      />
    </div>
  )
}
