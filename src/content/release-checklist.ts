// GOB-04: lista de verificación de salida a producción. Cada versión la lleva completa antes de marcarse como liberada.
// Si cambia la lista, cambia aquí y en .github/pull_request_template.md.
type Pair = [es: string, en: string]

export const RELEASE_CHECKLIST: { key: string; label: Pair; hint: Pair }[] = [
  {
    key: 'tech_review',
    label: ['Revisión de tecnología (Tech Implementation Review)', 'Technology review (Tech Implementation Review)'],
    hint: ['Visto bueno escrito de quien revisa tecnología en la empresa. Anota quién lo dio y en qué fecha. Sin ese visto bueno, ninguna tecnología nueva sale en vivo.', 'Written sign-off from whoever reviews technology in the company. Note who gave it and on which date. Without that sign-off, no new technology goes live.'],
  },
  {
    key: 'standard',
    label: ['Estándar de ingeniería', 'Engineering standard'],
    hint: ['Los controles que toca el cambio están citados y docs/standard-compliance.md quedó al día. Anota los controles.', 'The controls the change touches are cited and docs/standard-compliance.md is up to date. Note the controls.'],
  },
  {
    key: 'ci',
    label: ['Pruebas en verde sobre el commit que sale', 'Tests green on the commit going out'],
    hint: ['Pruebas de reglas y de permisos, build, pruebas de punta a punta y escaneo de datos prohibidos. Anota la corrida.', 'Rule and permission tests, build, end-to-end tests and the prohibited data scan. Note the run.'],
  },
  {
    key: 'migrations',
    label: ['Migraciones probadas y vuelta atrás escrita', 'Migrations tested and rollback written'],
    hint: ['Cada migración corrió hacia arriba y hacia abajo con datos; está escrito cómo se regresa a la versión anterior.', 'Every migration ran up and down with data; how to go back to the previous version is written down.'],
  },
  {
    key: 'two_people',
    label: ['Dos personas pueden desplegar y volver atrás', 'Two people can deploy and roll back'],
    hint: ['El componente "Despliegue y vuelta atrás" tiene dueño y suplente, y el suplente ya lo hizo al menos una vez.', 'The "Deployment and rollback" component has an owner and a backup, and the backup has done it at least once.'],
  },
  {
    key: 'backup',
    label: ['Respaldo verificado antes de desplegar', 'Backup verified before deploying'],
    hint: ['Hay un respaldo reciente y se sabe restaurar (docs/runbooks/respaldo-y-restauracion.md). Anota de cuándo es el respaldo.', 'There is a recent backup and restoring is known (docs/runbooks/respaldo-y-restauracion.md). Note when the backup is from.'],
  },
  {
    key: 'guide',
    label: ['Guía de usuario y notas de versión al día', 'User guide and release notes up to date'],
    hint: ['Lo que el equipo ve distinto ya está en la ayuda, en los primeros pasos y en las notas de esta versión, en el mismo cambio.', 'What the team sees differently is already in the help, the first steps and this release’s notes, in the same change.'],
  },
  {
    key: 'data',
    label: ['Sin datos reales en ambientes de prueba', 'No real data in test environments'],
    hint: ['Staging y las vistas previas corren con datos del generador, o hay una excepción firmada. Anota cuál de las dos.', 'Staging and previews run on generator data, or there is a signed exception. Note which of the two.'],
  },
]
