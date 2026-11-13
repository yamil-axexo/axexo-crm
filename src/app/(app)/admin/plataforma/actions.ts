'use server'
import { runAction, str } from '@/server/action'
import type { ActionResult } from '@/lib/errors'
import { withUser } from '@/server/db'
import { recordRedteam, setFlag, setPlatformValue, setPrivacyNotice, setSecretBackup } from '@/domain/plataforma/admin'
import { setNoticeRule } from '@/domain/plataforma/feed'
import { createMcpClient, revokeMcpClient } from '@/domain/plataforma/mcp-oauth'

type R = ActionResult<unknown>
const P = '/admin/plataforma'

export async function setFlagAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setFlag(ctx, str(fd, 'key'), { enabled: fd.get('enabled') === 'on', roles: fd.getAll('roles').map(String) as never, markets: fd.getAll('markets').map(String) })
    return { message: ['Guardado. Aplica desde la próxima pantalla que abra cada persona.', 'Saved. It applies from the next screen each person opens.'], revalidate: [P] }
  })
}

export async function setValueAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setPlatformValue(ctx, str(fd, 'key'), fd.get('value') === null ? (fd.get('kind') === 'boolean' ? false : null) : String(fd.get('value')), fd.get('confirmed') === 'on')
    return { message: ['Guardado y anotado en la bitácora.', 'Saved and logged.'], revalidate: [P, '/estado'] }
  })
}

export async function toggleRuleAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await withUser(ctx.user.id, (tx) => setNoticeRule(ctx, tx, str(fd, 'id'), str(fd, 'active') === '1'))
    return { message: ['Listo.', 'Done.'], revalidate: [P] }
  })
}

export async function redteamAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    const r = await recordRedteam(ctx, str(fd, 'agent'), fd.getAll('checked').map(String), str(fd, 'notes'))
    return {
      message: r.passed
        ? ['Revisión aprobada. El agente ya se puede encender en IA y asistencia.', 'Review passed. The agent can now be turned on in AI and assistance.']
        : ['Revisión guardada sin aprobar: falta marcar algún punto. El agente sigue sin poder actuar.', 'Review saved as not passed: some item is unchecked. The agent still cannot act.'],
      revalidate: [P],
    }
  })
}

export async function createMcpClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction<string>(async (ctx) => {
    const id = await createMcpClient(ctx, str(fd, 'name'), str(fd, 'redirect_uri'))
    return { data: id, message: [`Agente registrado. Su identificador es ${id}.`, `Agent registered. Its identifier is ${id}.`], revalidate: [P] }
  })
}

export async function revokeMcpClientAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await revokeMcpClient(ctx, str(fd, 'client_id'))
    return { message: ['Acceso retirado. Sus permisos vigentes dejaron de valer.', 'Access removed. Its current permissions stopped working.'], revalidate: [P] }
  })
}

export async function setSecretBackupAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setSecretBackup(ctx, str(fd, 'key'), str(fd, 'backup_id') || null)
    return { message: ['Suplente guardado.', 'Backup saved.'], revalidate: [P] }
  })
}

export async function setPrivacyNoticeAction(_: R | null, fd: FormData): Promise<R> {
  return runAction(async (ctx) => {
    await setPrivacyNotice(ctx, str(fd, 'market'), str(fd, 'version'))
    return { message: ['Versión del aviso guardada.', 'Notice version saved.'], revalidate: [P] }
  })
}
