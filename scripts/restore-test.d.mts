export type RestoreResult = { ok: boolean; minutes: number; before: Record<string, number>; after: Record<string, number>; error: string | null; scratch: string }
export function restoreTest(url: string, opts?: { record?: boolean; by?: string }): Promise<RestoreResult>
