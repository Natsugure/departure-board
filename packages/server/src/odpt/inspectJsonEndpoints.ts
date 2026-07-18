import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvToken } from '../shared/env.js'

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(here, '..', '..')

const ENDPOINTS: Record<string, string> = {
  train: 'odpt:Train',
  station: 'odpt:Station',
  stationTimetable: 'odpt:StationTimetable',
  railway: 'odpt:Railway',
  trainTimetable: 'odpt:TrainTimetable',
  trainType: 'odpt:TrainType',
}

async function fetchOne(name: string, path: string, token: string) {
  const url = `https://api-challenge.odpt.org/api/v4/${path}?odpt:operator=odpt.Operator:JR-East&acl:consumerKey=${token}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`[${name}] fetch failed: ${res.status} ${res.statusText}`)
  }
  const text = await res.text()
  const json = JSON.parse(text)
  const count = Array.isArray(json) ? json.length : 1

  console.log(`[${name}] entries: ${count}, bytes: ${text.length}`)
  console.log(JSON.stringify(Array.isArray(json) ? json.slice(0, 2) : json, null, 2))

  const outDir = join(here, 'tmp')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${name}.json`)
  writeFileSync(outPath, JSON.stringify(json, null, 2))
  console.log(`[${name}] full dump written to ${outPath}\n`)
}

async function main() {
  const token = loadEnvToken(serverRoot, 'ODPT_CHALLENGE_TOKEN')
  for (const [name, path] of Object.entries(ENDPOINTS)) {
    await fetchOne(name, path, token)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
