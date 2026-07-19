import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadEnvToken(serverRoot: string, key: string): string {
  const envPath = join(serverRoot, '.env')
  const raw = readFileSync(envPath, 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const lineKey = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (lineKey === key && value) return value
  }
  throw new Error(`${key} is not set in ${envPath}`)
}
