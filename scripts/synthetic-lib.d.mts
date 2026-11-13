import type postgres from 'postgres'

export type PlannedAccount = {
  i: number; id: string; level: number; parent_id: string | null; kind: 'organization' | 'distributor' | 'chain' | 'store'; name: string; lifecycle: string
  owner_id: string | null; phone: string | null; locality: string | null; region: string | null; latitude: number | null; longitude: number | null
  tax_id_last4: string | null; age_days: number; edge: string | null
}
export type GenerateOptions = { market: string; seed?: number; accounts?: number; depth?: number; edgeCases?: boolean; runBy?: string; appEnv?: string }
export function rng(seedText: string): () => number
export function syntheticId(market: string, seed: number, i: number): string
export function rfcCheckDigit(base12: string): string
export function syntheticRfc(r: () => number): string
export function syntheticEin(r: () => number): string
export function syntheticNit(r: () => number): string
export function taxIdFor(market: string, r: () => number): string
export const MARKETS: Record<string, { currency: string }>
export function plan(options: Omit<GenerateOptions, 'runBy' | 'appEnv'> & { owners?: string[] }): PlannedAccount[]
export function generate(sql: postgres.Sql, options: GenerateOptions): Promise<{ runId: string | null; accounts: number; metrics: number; max_depth: number; edge_cases: number; unowned: number }>
