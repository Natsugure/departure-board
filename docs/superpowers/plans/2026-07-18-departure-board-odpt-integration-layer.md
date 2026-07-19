# Departure Board: ODPT Integration Layer (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server-side data layer that turns ODPT's JSON-LD APIs (station timetable + real-time train status) into a `GET /departures?offset=0-30` endpoint returning the next 2 trains from 赤羽駅3番線（上野東京ライン, JU04）with scheduled time, delay, train type, destination, and car composition.

**Architecture:** A small pipeline of pure/injectable modules — ODPT client → calendar util → master data cache → station timetable cache → real-time train status fetch → a pure `composeDepartures` function that merges everything → a stateful orchestrator that holds the caches → a Hono route that exposes it. No GTFS static parsing, no GTFS-RT protobuf in this pipeline (see `docs/superpowers/specs/2026-07-18-departure-board-architecture-and-rt-spike-design.md` for why).

**Tech Stack:** TypeScript, Node.js 22, Hono, Vitest (new), `@holiday-jp/holiday_jp` (new).

## Global Constraints

- Node.js >= 22 (already installed: v22.14.0; matches `gtfs-realtime-bindings` engine requirement from Phase 0).
- `packages/server/tsconfig.json` has `strict: true`, `module: NodeNext`, `verbatimModuleSyntax: true`, and **no** `esModuleInterop`. All relative imports must use a `.js` specifier (even though the source file is `.ts`) — e.g. `import { x } from '../shared/env.js'`.
- CJS packages that don't statically expose named exports must be loaded via `createRequire(import.meta.url)`, not `import { x } from 'pkg'` — this bit us with `gtfs-realtime-bindings` in Phase 0 and applies again to `@holiday-jp/holiday_jp` (confirmed CJS, `main: lib/holiday_jp.js`, no `exports` map).
- ODPT token must be read via the existing `loadEnvToken(serverRoot, key)` helper in `packages/server/src/shared/env.ts`. Do not add `dotenv` or any other env-loading dependency.
- `odpt:delay` is in **seconds** (confirmed empirically: all observed values are multiples of 60, up to 4860).
- JR East `StationTimetable`/`TrainTimetable` only use two calendar values: `odpt.Calendar:Weekday` and `odpt.Calendar:SaturdayHoliday`.
- All date/time logic assumes the process runs with `TZ=Asia/Tokyo` (set via `vitest.config.ts`'s `test.env.TZ` for tests, and as the first line of `index.ts` in production) — ODPT departure times are JST wall-clock strings with no UTC offset info, and the host machine's own timezone cannot be assumed (a Raspberry Pi may default to UTC). Do not use `Date#toISOString()` for anything calendar-day-related (it's always UTC regardless of `TZ`); use local `getFullYear`/`getMonth`/`getDate`/`getHours`/`getMinutes`/`getDay` instead, which do respect `TZ`.
- Akabane platform 3 (上野東京ライン, station code `JU04`) is **two** ODPT station IDs that must be merged: `odpt.Station:JR-East.Takasaki.Akabane` and `odpt.Station:JR-East.Utsunomiya.Akabane`. Direction is confirmed `Inbound` (verified: first destination for both is 小田原/熱海 via Tokyo — matches the 上野・東京・横浜方面 mockup).
- Scoped queries (`odpt:station=...`) return complete, un-truncated results (verified: exactly 4 StationTimetable entries per station, no 1000-record cap). Do not query `odpt:StationTimetable`/`odpt:TrainTimetable` operator-wide in production code.
- ODPT base URL: `https://api-challenge.odpt.org/api/v4`. Build query strings by simple interpolation (`key=value` joined with `&`, `acl:consumerKey` last) — this is the pattern already proven working in `packages/server/src/gtfs/realtime/inspectVehiclePositions.ts` and `packages/server/src/odpt/inspectJsonEndpoints.ts`. Do not switch to `URLSearchParams` (untested encoding change, no reason to risk it).
- Existing spike scripts (`inspectVehiclePositions.ts`, `inspectJsonEndpoints.ts`) are out of scope for this plan — do not refactor them to reuse the new client.

---

### Task 1: Add Vitest test tooling

**Files:**
- Modify: `packages/server/package.json`
- Create: `packages/server/vitest.config.ts`
- Test: `packages/server/src/sanity.test.ts` (deleted at the end of this task once it's proven the setup works — see Step 4)

**Interfaces:**
- Produces: `pnpm --filter server test` runs Vitest once (CI-style, non-watch).

- [ ] **Step 1: Add the `vitest` dependency and `test` script**

Edit `packages/server/package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "inspect:rt": "tsx src/gtfs/realtime/inspectVehiclePositions.ts",
    "inspect:odpt": "tsx src/odpt/inspectJsonEndpoints.ts"
  },
  "dependencies": {
    "@hono/node-server": "^2.0.10",
    "hono": "^4.12.30"
  },
  "devDependencies": {
    "@types/node": "^26.1.1",
    "tsx": "^4.23.0",
    "typescript": "^7.0.2",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // ODPT times are always JST wall-clock. Pin the test workers' timezone
    // so date/time logic (calendar.ts, composeDepartures.ts,
    // departureBoardState.ts) behaves the same in CI as it will on the
    // Raspberry Pi in production, regardless of the host machine's own
    // configured timezone.
    env: { TZ: 'Asia/Tokyo' },
  },
})
```

- [ ] **Step 3: Install and write a sanity test**

Run: `pnpm install` (from repo root)

Create `packages/server/src/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 4: Run it and then delete the sanity file**

Run: `pnpm --filter server test`
Expected: `1 passed`

Then delete `packages/server/src/sanity.test.ts` — it was only there to prove the harness works; real tests start in Task 3.

- [ ] **Step 5: Commit**

```bash
git add packages/server/package.json packages/server/vitest.config.ts pnpm-lock.yaml
git commit -m "test: add vitest to server package"
```

---

### Task 2: ODPT shared types, HTTP client, and track config

**Files:**
- Create: `packages/server/src/odpt/types.ts`
- Create: `packages/server/src/odpt/client.ts`
- Create: `packages/server/src/odpt/client.test.ts`
- Create: `packages/server/src/config/track.ts`

**Interfaces:**
- Consumes: nothing new (uses Node global `fetch`)
- Produces:
  - `fetchOdptResource<T>(token: string, resourceType: string, params?: Record<string, string>): Promise<T[]>`
  - Types: `OdptTrainType`, `OdptStation`, `OdptStationTimetableObject`, `OdptStationTimetable`, `OdptTrain`
  - `TrackConfig` interface and `AKABANE_TRACK_3: TrackConfig` constant

- [ ] **Step 1: Write the shared ODPT response types**

Create `packages/server/src/odpt/types.ts`:

```ts
export interface OdptTrainType {
  'owl:sameAs': string
  'dc:title': string
}

export interface OdptStation {
  'owl:sameAs': string
  'dc:title': string
}

export interface OdptStationTimetableObject {
  'odpt:trainNumber': string
  'odpt:trainType': string
  'odpt:departureTime': string
  'odpt:destinationStation'?: string[]
}

export interface OdptStationTimetable {
  'owl:sameAs': string
  'odpt:railDirection': string
  'odpt:calendar': string
  'odpt:stationTimetableObject': OdptStationTimetableObject[]
}

export interface OdptTrain {
  'odpt:trainNumber': string
  'odpt:railway': string
  'odpt:delay': number
  'odpt:carComposition'?: number
}
```

- [ ] **Step 2: Write the failing test for the client**

Create `packages/server/src/odpt/client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchOdptResource } from './client.js'

describe('fetchOdptResource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the URL with params and the token, and returns parsed JSON', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => [{ hello: 'world' }],
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await fetchOdptResource<{ hello: string }>('TOKEN123', 'odpt:Station', {
      'odpt:operator': 'odpt.Operator:JR-East',
    })

    expect(result).toEqual([{ hello: 'world' }])
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api-challenge.odpt.org/api/v4/odpt:Station?odpt:operator=odpt.Operator:JR-East&acl:consumerKey=TOKEN123',
    )
  })

  it('throws when the response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => [],
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(fetchOdptResource('TOKEN123', 'odpt:Train', {})).rejects.toThrow(
      'ODPT request failed: odpt:Train 500 Internal Server Error',
    )
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server test client.test`
Expected: FAIL with "Cannot find module './client.js'" (or similar — the file doesn't exist yet)

- [ ] **Step 4: Implement the client**

Create `packages/server/src/odpt/client.ts`:

```ts
const ODPT_BASE_URL = 'https://api-challenge.odpt.org/api/v4'

export async function fetchOdptResource<T>(
  token: string,
  resourceType: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const paramPairs = Object.entries(params).map(([key, value]) => `${key}=${value}`)
  paramPairs.push(`acl:consumerKey=${token}`)
  const url = `${ODPT_BASE_URL}/${resourceType}?${paramPairs.join('&')}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`ODPT request failed: ${resourceType} ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T[]>
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test client.test`
Expected: `2 passed`

- [ ] **Step 6: Add the fixed track config (no test — plain data)**

Create `packages/server/src/config/track.ts`:

```ts
export interface TrackConfig {
  stationIds: string[]
  railwayIds: string[]
  direction: 'Inbound' | 'Outbound'
  platformLabel: string
  lineLabel: string
  lineBadge: string
  destinationArea: string
}

export const AKABANE_TRACK_3: TrackConfig = {
  stationIds: [
    'odpt.Station:JR-East.Takasaki.Akabane',
    'odpt.Station:JR-East.Utsunomiya.Akabane',
  ],
  railwayIds: [
    'odpt.Railway:JR-East.Takasaki',
    'odpt.Railway:JR-East.Utsunomiya',
  ],
  direction: 'Inbound',
  platformLabel: '3',
  lineLabel: '上野東京ライン',
  lineBadge: 'JU',
  destinationArea: '上野・東京・横浜方面',
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/odpt/types.ts packages/server/src/odpt/client.ts packages/server/src/odpt/client.test.ts packages/server/src/config/track.ts
git commit -m "feat: add ODPT client, shared types, and Akabane track 3 config"
```

---

### Task 3: Calendar / holiday util

**Files:**
- Create: `packages/server/src/schedule/calendar.ts`
- Create: `packages/server/src/schedule/calendar.test.ts`
- Modify: `packages/server/package.json` (add `@holiday-jp/holiday_jp` dependency)

**Interfaces:**
- Produces: `type CalendarType = 'Weekday' | 'SaturdayHoliday'`, `todaysCalendarType(date: Date): CalendarType`

- [ ] **Step 1: Add the dependency**

Edit `packages/server/package.json`, add to `dependencies`:

```json
"@holiday-jp/holiday_jp": "^2.5.1"
```

Run: `pnpm install`

- [ ] **Step 2: Write the failing tests**

Create `packages/server/src/schedule/calendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { todaysCalendarType } from './calendar.js'

describe('todaysCalendarType', () => {
  it('returns Weekday for an ordinary Tuesday', () => {
    // 2026-07-14 is a Tuesday, not a Japanese public holiday
    expect(todaysCalendarType(new Date('2026-07-14T10:00:00+09:00'))).toBe('Weekday')
  })

  it('returns SaturdayHoliday for a Saturday', () => {
    // 2026-07-18 is a Saturday
    expect(todaysCalendarType(new Date('2026-07-18T10:00:00+09:00'))).toBe('SaturdayHoliday')
  })

  it('returns SaturdayHoliday for a Sunday', () => {
    // 2026-07-19 is a Sunday
    expect(todaysCalendarType(new Date('2026-07-19T10:00:00+09:00'))).toBe('SaturdayHoliday')
  })

  it('returns SaturdayHoliday for a weekday public holiday (Marine Day)', () => {
    // 2026-07-20 is Marine Day (海の日), a Monday
    expect(todaysCalendarType(new Date('2026-07-20T10:00:00+09:00'))).toBe('SaturdayHoliday')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter server test calendar.test`
Expected: FAIL with "Cannot find module './calendar.js'"

- [ ] **Step 4: Implement the util**

Create `packages/server/src/schedule/calendar.ts`:

```ts
import { createRequire } from 'node:module'

// @holiday-jp/holiday_jp is CommonJS with no `exports` map, so a named
// import isn't statically analyzable by Node's ESM loader — load it via
// createRequire instead (same pattern as gtfs-realtime-bindings in Phase 0).
const require = createRequire(import.meta.url)
const holidayJp = require('@holiday-jp/holiday_jp') as { isHoliday(date: Date): boolean }

export type CalendarType = 'Weekday' | 'SaturdayHoliday'

export function todaysCalendarType(date: Date): CalendarType {
  // Relies on TZ=Asia/Tokyo being set for the process (see
  // composeDepartures.ts for the same constraint) so getDay() reads the JST
  // day of week, not the host machine's local day of week.
  const day = date.getDay() // 0 = Sunday, 6 = Saturday
  if (day === 0 || day === 6 || holidayJp.isHoliday(date)) {
    return 'SaturdayHoliday'
  }
  return 'Weekday'
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server test calendar.test`
Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json packages/server/pnpm-lock.yaml packages/server/src/schedule/calendar.ts packages/server/src/schedule/calendar.test.ts
git commit -m "feat: add today's JR calendar type (Weekday/SaturdayHoliday) util"
```

---

### Task 4: Master data cache (train type labels, station names)

**Files:**
- Create: `packages/server/src/odpt/masterData.ts`
- Create: `packages/server/src/odpt/masterData.test.ts`

**Interfaces:**
- Consumes: `fetchOdptResource<T>` from `./client.js` (Task 2), `OdptTrainType`/`OdptStation` from `./types.js` (Task 2)
- Produces: `interface MasterData { trainTypeLabels: Map<string, string>; stationNames: Map<string, string> }`, `loadMasterData(token: string): Promise<MasterData>`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/odpt/masterData.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as client from './client.js'
import { loadMasterData } from './masterData.js'

describe('loadMasterData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds trainType and station label maps keyed by owl:sameAs', async () => {
    vi.spyOn(client, 'fetchOdptResource').mockImplementation(async (_token, resourceType) => {
      if (resourceType === 'odpt:TrainType') {
        return [
          { 'owl:sameAs': 'odpt.TrainType:JR-East.Local', 'dc:title': '普通' },
          { 'owl:sameAs': 'odpt.TrainType:JR-East.Rapid', 'dc:title': '快速' },
        ] as any
      }
      if (resourceType === 'odpt:Station') {
        return [
          { 'owl:sameAs': 'odpt.Station:JR-East.Takasaki.Ueno', 'dc:title': '上野' },
        ] as any
      }
      throw new Error(`unexpected resourceType: ${resourceType}`)
    })

    const master = await loadMasterData('TOKEN123')

    expect(master.trainTypeLabels.get('odpt.TrainType:JR-East.Local')).toBe('普通')
    expect(master.trainTypeLabels.get('odpt.TrainType:JR-East.Rapid')).toBe('快速')
    expect(master.stationNames.get('odpt.Station:JR-East.Takasaki.Ueno')).toBe('上野')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test masterData.test`
Expected: FAIL with "Cannot find module './masterData.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/odpt/masterData.ts`:

```ts
import { fetchOdptResource } from './client.js'
import type { OdptTrainType, OdptStation } from './types.js'

export interface MasterData {
  trainTypeLabels: Map<string, string>
  stationNames: Map<string, string>
}

export async function loadMasterData(token: string): Promise<MasterData> {
  const [trainTypes, stations] = await Promise.all([
    fetchOdptResource<OdptTrainType>(token, 'odpt:TrainType', {
      'odpt:operator': 'odpt.Operator:JR-East',
    }),
    fetchOdptResource<OdptStation>(token, 'odpt:Station', {
      'odpt:operator': 'odpt.Operator:JR-East',
    }),
  ])

  return {
    trainTypeLabels: new Map(trainTypes.map((t) => [t['owl:sameAs'], t['dc:title']])),
    stationNames: new Map(stations.map((s) => [s['owl:sameAs'], s['dc:title']])),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test masterData.test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/odpt/masterData.ts packages/server/src/odpt/masterData.test.ts
git commit -m "feat: cache ODPT train type and station name master data"
```

---

### Task 5: Station timetable cache

**Files:**
- Create: `packages/server/src/schedule/stationTimetableCache.ts`
- Create: `packages/server/src/schedule/stationTimetableCache.test.ts`

**Interfaces:**
- Consumes: `fetchOdptResource<T>` (Task 2), `OdptStationTimetable` (Task 2), `TrackConfig` (Task 2), `CalendarType` (Task 3)
- Produces: `interface TimetableEntry { trainNumber: string; trainTypeId: string; departureTime: string; destinationStationId?: string }`, `fetchTodaysDepartures(token: string, config: TrackConfig, calendarType: CalendarType): Promise<TimetableEntry[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/schedule/stationTimetableCache.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as client from '../odpt/client.js'
import { fetchTodaysDepartures } from './stationTimetableCache.js'
import type { TrackConfig } from '../config/track.js'

const testConfig: TrackConfig = {
  stationIds: ['odpt.Station:JR-East.Takasaki.Akabane', 'odpt.Station:JR-East.Utsunomiya.Akabane'],
  railwayIds: ['odpt.Railway:JR-East.Takasaki', 'odpt.Railway:JR-East.Utsunomiya'],
  direction: 'Inbound',
  platformLabel: '3',
  lineLabel: '上野東京ライン',
  lineBadge: 'JU',
  destinationArea: '上野・東京・横浜方面',
}

describe('fetchTodaysDepartures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('merges and sorts departures from both stations for the matching direction/calendar', async () => {
    vi.spyOn(client, 'fetchOdptResource').mockImplementation(async (_token, _resourceType, params) => {
      const stationId = params?.['odpt:station']
      if (stationId === 'odpt.Station:JR-East.Takasaki.Akabane') {
        return [
          {
            'owl:sameAs': 'odpt.StationTimetable:JR-East.Takasaki.Akabane.Inbound.Weekday',
            'odpt:railDirection': 'odpt.RailDirection:Inbound',
            'odpt:calendar': 'odpt.Calendar:Weekday',
            'odpt:stationTimetableObject': [
              {
                'odpt:trainNumber': '851M',
                'odpt:trainType': 'odpt.TrainType:JR-East.Local',
                'odpt:departureTime': '19:15',
                'odpt:destinationStation': ['odpt.Station:JR-East.Takasaki.Ueno'],
              },
            ],
          },
        ] as any
      }
      if (stationId === 'odpt.Station:JR-East.Utsunomiya.Akabane') {
        return [
          {
            'owl:sameAs': 'odpt.StationTimetable:JR-East.Utsunomiya.Akabane.Inbound.Weekday',
            'odpt:railDirection': 'odpt.RailDirection:Inbound',
            'odpt:calendar': 'odpt.Calendar:Weekday',
            'odpt:stationTimetableObject': [
              {
                'odpt:trainNumber': '441M',
                'odpt:trainType': 'odpt.TrainType:JR-East.Local',
                'odpt:departureTime': '19:08',
                'odpt:destinationStation': ['odpt.Station:JR-East.Tokaido.Odawara'],
              },
            ],
          },
        ] as any
      }
      throw new Error(`unexpected station: ${stationId}`)
    })

    const result = await fetchTodaysDepartures('TOKEN123', testConfig, 'Weekday')

    expect(result).toEqual([
      {
        trainNumber: '441M',
        trainTypeId: 'odpt.TrainType:JR-East.Local',
        departureTime: '19:08',
        destinationStationId: 'odpt.Station:JR-East.Tokaido.Odawara',
      },
      {
        trainNumber: '851M',
        trainTypeId: 'odpt.TrainType:JR-East.Local',
        departureTime: '19:15',
        destinationStationId: 'odpt.Station:JR-East.Takasaki.Ueno',
      },
    ])
  })

  it('throws if no matching direction/calendar timetable is found for a station', async () => {
    vi.spyOn(client, 'fetchOdptResource').mockResolvedValue([])

    await expect(fetchTodaysDepartures('TOKEN123', testConfig, 'Weekday')).rejects.toThrow(
      'No StationTimetable found for odpt.Station:JR-East.Takasaki.Akabane',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test stationTimetableCache.test`
Expected: FAIL with "Cannot find module './stationTimetableCache.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/schedule/stationTimetableCache.ts`:

```ts
import { fetchOdptResource } from '../odpt/client.js'
import type { OdptStationTimetable } from '../odpt/types.js'
import type { TrackConfig } from '../config/track.js'
import type { CalendarType } from './calendar.js'

export interface TimetableEntry {
  trainNumber: string
  trainTypeId: string
  departureTime: string
  destinationStationId?: string
}

export async function fetchTodaysDepartures(
  token: string,
  config: TrackConfig,
  calendarType: CalendarType,
): Promise<TimetableEntry[]> {
  const entries: TimetableEntry[] = []

  for (const stationId of config.stationIds) {
    const timetables = await fetchOdptResource<OdptStationTimetable>(token, 'odpt:StationTimetable', {
      'odpt:station': stationId,
    })

    const match = timetables.find(
      (t) =>
        t['odpt:railDirection'] === `odpt.RailDirection:${config.direction}` &&
        t['odpt:calendar'] === `odpt.Calendar:${calendarType}`,
    )
    if (!match) {
      throw new Error(
        `No StationTimetable found for ${stationId} direction=${config.direction} calendar=${calendarType}`,
      )
    }

    for (const obj of match['odpt:stationTimetableObject']) {
      entries.push({
        trainNumber: obj['odpt:trainNumber'],
        trainTypeId: obj['odpt:trainType'],
        departureTime: obj['odpt:departureTime'],
        destinationStationId: obj['odpt:destinationStation']?.[0],
      })
    }
  }

  entries.sort((a, b) => toMinutes(a.departureTime) - toMinutes(b.departureTime))
  return entries
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test stationTimetableCache.test`
Expected: `2 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/schedule/stationTimetableCache.ts packages/server/src/schedule/stationTimetableCache.test.ts
git commit -m "feat: fetch and merge today's StationTimetable for Akabane track 3"
```

---

### Task 6: Real-time train status fetch

**Files:**
- Create: `packages/server/src/realtime/trainStatusPoller.ts`
- Create: `packages/server/src/realtime/trainStatusPoller.test.ts`

**Interfaces:**
- Consumes: `fetchOdptResource<T>` (Task 2), `OdptTrain` (Task 2)
- Produces: `interface TrainStatus { delaySeconds: number; carComposition?: number }`, `fetchTrainStatuses(token: string, railwayIds: string[]): Promise<Map<string, TrainStatus>>`

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/realtime/trainStatusPoller.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as client from '../odpt/client.js'
import { fetchTrainStatuses } from './trainStatusPoller.js'

describe('fetchTrainStatuses', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keys statuses by trainNumber, filtered to the given railways', async () => {
    vi.spyOn(client, 'fetchOdptResource').mockResolvedValue([
      {
        'odpt:trainNumber': '851M',
        'odpt:railway': 'odpt.Railway:JR-East.Takasaki',
        'odpt:delay': 120,
        'odpt:carComposition': 15,
      },
      {
        'odpt:trainNumber': '454M',
        'odpt:railway': 'odpt.Railway:JR-East.JobanRapid',
        'odpt:delay': 0,
        'odpt:carComposition': 10,
      },
    ] as any)

    const result = await fetchTrainStatuses('TOKEN123', [
      'odpt.Railway:JR-East.Takasaki',
      'odpt.Railway:JR-East.Utsunomiya',
    ])

    expect(result.get('851M')).toEqual({ delaySeconds: 120, carComposition: 15 })
    expect(result.has('454M')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test trainStatusPoller.test`
Expected: FAIL with "Cannot find module './trainStatusPoller.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/realtime/trainStatusPoller.ts`:

```ts
import { fetchOdptResource } from '../odpt/client.js'
import type { OdptTrain } from '../odpt/types.js'

export interface TrainStatus {
  delaySeconds: number
  carComposition?: number
}

export async function fetchTrainStatuses(
  token: string,
  railwayIds: string[],
): Promise<Map<string, TrainStatus>> {
  const trains = await fetchOdptResource<OdptTrain>(token, 'odpt:Train', {
    'odpt:operator': 'odpt.Operator:JR-East',
  })

  const result = new Map<string, TrainStatus>()
  for (const train of trains) {
    if (!railwayIds.includes(train['odpt:railway'])) continue
    result.set(train['odpt:trainNumber'], {
      delaySeconds: train['odpt:delay'],
      carComposition: train['odpt:carComposition'],
    })
  }
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test trainStatusPoller.test`
Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/realtime/trainStatusPoller.ts packages/server/src/realtime/trainStatusPoller.test.ts
git commit -m "feat: fetch real-time delay/car composition from odpt:Train"
```

---

### Task 7: `composeDepartures` — the core merge logic

**Files:**
- Create: `packages/server/src/departures/composeDepartures.ts`
- Create: `packages/server/src/departures/composeDepartures.test.ts`

**Interfaces:**
- Consumes: `TimetableEntry` (Task 5), `TrainStatus` (Task 6)
- Produces: `interface DepartureView { trainType: string; destination: string; carComposition?: number; scheduledTime: string; delaySeconds: number }`, `composeDepartures(params): DepartureView[]`

This is a pure function — no network, no mocks needed. This is the most important test file in the plan; cover it thoroughly.

- [ ] **Step 1: Write the failing tests**

Create `packages/server/src/departures/composeDepartures.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { composeDepartures } from './composeDepartures.js'
import type { TimetableEntry } from '../schedule/stationTimetableCache.js'
import type { TrainStatus } from '../realtime/trainStatusPoller.js'

const departures: TimetableEntry[] = [
  {
    trainNumber: '441M',
    trainTypeId: 'odpt.TrainType:JR-East.Local',
    departureTime: '19:00',
    destinationStationId: 'odpt.Station:JR-East.Tokaido.Odawara',
  },
  {
    trainNumber: '851M',
    trainTypeId: 'odpt.TrainType:JR-East.Local',
    departureTime: '19:08',
    destinationStationId: 'odpt.Station:JR-East.Takasaki.Ueno',
  },
  {
    trainNumber: '453M',
    trainTypeId: 'odpt.TrainType:JR-East.Rapid',
    departureTime: '19:15',
    destinationStationId: 'odpt.Station:JR-East.Tokaido.Odawara',
  },
]

const trainTypeLabels = new Map([
  ['odpt.TrainType:JR-East.Local', '普通'],
  ['odpt.TrainType:JR-East.Rapid', '快速'],
])

const stationNames = new Map([
  ['odpt.Station:JR-East.Tokaido.Odawara', '小田原'],
  ['odpt.Station:JR-East.Takasaki.Ueno', '上野'],
])

describe('composeDepartures', () => {
  it('returns the next 2 departures at/after now, sorted', () => {
    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result).toEqual([
      { trainType: '普通', destination: '上野', carComposition: undefined, scheduledTime: '19:08', delaySeconds: 0 },
      { trainType: '快速', destination: '小田原', carComposition: undefined, scheduledTime: '19:15', delaySeconds: 0 },
    ])
  })

  it('shifts the effective "now" forward by offsetMinutes', () => {
    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 10, // effective now = 19:11, so 19:08 train is gone
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result).toEqual([
      { trainType: '快速', destination: '小田原', carComposition: undefined, scheduledTime: '19:15', delaySeconds: 0 },
    ])
  })

  it('applies real-time delay and car composition when the train number matches', () => {
    const trainStatusByNumber = new Map<string, TrainStatus>([
      ['851M', { delaySeconds: 120, carComposition: 15 }],
    ])

    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber,
      trainTypeLabels,
      stationNames,
    })

    expect(result[0]).toEqual({
      trainType: '普通',
      destination: '上野',
      carComposition: 15,
      scheduledTime: '19:08',
      delaySeconds: 120,
    })
  })

  it('defaults delaySeconds to 0 and carComposition to undefined with no real-time match', () => {
    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
    })

    expect(result[0].delaySeconds).toBe(0)
    expect(result[0].carComposition).toBeUndefined()
  })

  it('falls back to the raw ID when a label is missing from the master data maps', () => {
    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 0,
      todaysDepartures: [departures[1]],
      trainStatusByNumber: new Map(),
      trainTypeLabels: new Map(), // empty — no label known
      stationNames: new Map(), // empty — no name known
    })

    expect(result[0].trainType).toBe('odpt.TrainType:JR-East.Local')
    expect(result[0].destination).toBe('odpt.Station:JR-East.Takasaki.Ueno')
  })

  it('respects a custom limit', () => {
    const result = composeDepartures({
      now: new Date('2026-07-18T19:01:00+09:00'),
      offsetMinutes: 0,
      todaysDepartures: departures,
      trainStatusByNumber: new Map(),
      trainTypeLabels,
      stationNames,
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test composeDepartures.test`
Expected: FAIL with "Cannot find module './composeDepartures.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/departures/composeDepartures.ts`:

```ts
import type { TimetableEntry } from '../schedule/stationTimetableCache.js'
import type { TrainStatus } from '../realtime/trainStatusPoller.js'

export interface DepartureView {
  trainType: string
  destination: string
  carComposition?: number
  scheduledTime: string
  delaySeconds: number
}

export interface ComposeDeparturesParams {
  now: Date
  offsetMinutes: number
  todaysDepartures: TimetableEntry[]
  trainStatusByNumber: Map<string, TrainStatus>
  trainTypeLabels: Map<string, string>
  stationNames: Map<string, string>
  limit?: number
}

export function composeDepartures(params: ComposeDeparturesParams): DepartureView[] {
  const { now, offsetMinutes, todaysDepartures, trainStatusByNumber, trainTypeLabels, stationNames } = params
  const limit = params.limit ?? 2

  // ODPT departure times are JST wall-clock strings. This relies on the
  // process running with TZ=Asia/Tokyo (set in vitest.config.ts for tests,
  // and as the first line of index.ts in production) so that
  // now.getHours()/getMinutes() read JST regardless of the host's own
  // configured timezone.
  const targetMinutes = now.getHours() * 60 + now.getMinutes() + offsetMinutes

  const upcoming = todaysDepartures
    .filter((entry) => toMinutes(entry.departureTime) >= targetMinutes)
    .sort((a, b) => toMinutes(a.departureTime) - toMinutes(b.departureTime))
    .slice(0, limit)

  return upcoming.map((entry) => {
    const status = trainStatusByNumber.get(entry.trainNumber)
    return {
      trainType: trainTypeLabels.get(entry.trainTypeId) ?? entry.trainTypeId,
      destination: entry.destinationStationId
        ? (stationNames.get(entry.destinationStationId) ?? entry.destinationStationId)
        : '',
      carComposition: status?.carComposition,
      scheduledTime: entry.departureTime,
      delaySeconds: status?.delaySeconds ?? 0,
    }
  })
}

function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number)
  return hours * 60 + minutes
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test composeDepartures.test`
Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/departures/composeDepartures.ts packages/server/src/departures/composeDepartures.test.ts
git commit -m "feat: add composeDepartures — merges timetable, delay, and labels"
```

---

### Task 8: `DepartureBoardState` orchestrator

**Files:**
- Create: `packages/server/src/state/departureBoardState.ts`
- Create: `packages/server/src/state/departureBoardState.test.ts`

**Interfaces:**
- Consumes: `MasterData` (Task 4), `TimetableEntry` (Task 5), `TrainStatus` (Task 6), `composeDepartures`/`DepartureView` (Task 7), `TrackConfig` (Task 2), `CalendarType`/`todaysCalendarType` (Task 3)
- Produces: `interface DepartureBoardDeps { loadMasterData; fetchTodaysDepartures; fetchTrainStatuses }`, `class DepartureBoardState` with `refreshMasterData()`, `refreshTodaysDepartures(now)`, `refreshTrainStatuses()`, `getDepartures(now, offsetMinutes)`

Dependencies are injected via the constructor (not imported directly) so this class can be tested without mocking modules.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/state/departureBoardState.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { DepartureBoardState } from './departureBoardState.js'
import { AKABANE_TRACK_3 } from '../config/track.js'

function buildDeps() {
  return {
    loadMasterData: vi.fn().mockResolvedValue({
      trainTypeLabels: new Map([['odpt.TrainType:JR-East.Local', '普通']]),
      stationNames: new Map([['odpt.Station:JR-East.Takasaki.Ueno', '上野']]),
    }),
    fetchTodaysDepartures: vi.fn().mockResolvedValue([
      {
        trainNumber: '851M',
        trainTypeId: 'odpt.TrainType:JR-East.Local',
        departureTime: '19:08',
        destinationStationId: 'odpt.Station:JR-East.Takasaki.Ueno',
      },
    ]),
    fetchTrainStatuses: vi.fn().mockResolvedValue(new Map([['851M', { delaySeconds: 60, carComposition: 15 }]])),
  }
}

describe('DepartureBoardState', () => {
  it('throws from getDepartures before refreshMasterData has run', () => {
    const state = new DepartureBoardState('TOKEN123', AKABANE_TRACK_3, buildDeps())
    expect(() => state.getDepartures(new Date(), 0)).toThrow('Master data not loaded yet')
  })

  it('composes departures once all caches are refreshed', async () => {
    const deps = buildDeps()
    const state = new DepartureBoardState('TOKEN123', AKABANE_TRACK_3, deps)

    const now = new Date('2026-07-18T19:00:00+09:00')
    await state.refreshMasterData()
    await state.refreshTodaysDepartures(now)
    await state.refreshTrainStatuses()

    expect(deps.fetchTodaysDepartures).toHaveBeenCalledWith('TOKEN123', AKABANE_TRACK_3, 'SaturdayHoliday')
    expect(deps.fetchTrainStatuses).toHaveBeenCalledWith('TOKEN123', AKABANE_TRACK_3.railwayIds)

    const result = state.getDepartures(now, 0)
    expect(result).toEqual([
      { trainType: '普通', destination: '上野', carComposition: 15, scheduledTime: '19:08', delaySeconds: 60 },
    ])
  })

  it('reports whether a daily refresh is needed based on the calendar date', async () => {
    const deps = buildDeps()
    const state = new DepartureBoardState('TOKEN123', AKABANE_TRACK_3, deps)
    const day1 = new Date('2026-07-18T19:00:00+09:00')
    const day2 = new Date('2026-07-19T08:00:00+09:00')

    expect(state.needsDailyRefresh(day1)).toBe(true) // nothing fetched yet

    await state.refreshTodaysDepartures(day1)
    expect(state.needsDailyRefresh(day1)).toBe(false)
    expect(state.needsDailyRefresh(day2)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test departureBoardState.test`
Expected: FAIL with "Cannot find module './departureBoardState.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/state/departureBoardState.ts`:

```ts
import type { TrackConfig } from '../config/track.js'
import type { MasterData } from '../odpt/masterData.js'
import type { TimetableEntry } from '../schedule/stationTimetableCache.js'
import type { TrainStatus } from '../realtime/trainStatusPoller.js'
import type { CalendarType } from '../schedule/calendar.js'
import { todaysCalendarType } from '../schedule/calendar.js'
import { composeDepartures, type DepartureView } from '../departures/composeDepartures.js'

export interface DepartureBoardDeps {
  loadMasterData: (token: string) => Promise<MasterData>
  fetchTodaysDepartures: (token: string, config: TrackConfig, calendarType: CalendarType) => Promise<TimetableEntry[]>
  fetchTrainStatuses: (token: string, railwayIds: string[]) => Promise<Map<string, TrainStatus>>
}

export class DepartureBoardState {
  private masterData?: MasterData
  private todaysDepartures: TimetableEntry[] = []
  private trainStatusByNumber: Map<string, TrainStatus> = new Map()
  private lastRefreshedDate: string | null = null

  constructor(
    private readonly token: string,
    private readonly config: TrackConfig,
    private readonly deps: DepartureBoardDeps,
  ) {}

  async refreshMasterData(): Promise<void> {
    this.masterData = await this.deps.loadMasterData(this.token)
  }

  async refreshTodaysDepartures(now: Date): Promise<void> {
    const calendarType = todaysCalendarType(now)
    this.todaysDepartures = await this.deps.fetchTodaysDepartures(this.token, this.config, calendarType)
    this.lastRefreshedDate = dateKey(now)
  }

  async refreshTrainStatuses(): Promise<void> {
    this.trainStatusByNumber = await this.deps.fetchTrainStatuses(this.token, this.config.railwayIds)
  }

  needsDailyRefresh(now: Date): boolean {
    return this.lastRefreshedDate !== dateKey(now)
  }

  getDepartures(now: Date, offsetMinutes: number): DepartureView[] {
    if (!this.masterData) {
      throw new Error('Master data not loaded yet')
    }
    return composeDepartures({
      now,
      offsetMinutes,
      todaysDepartures: this.todaysDepartures,
      trainStatusByNumber: this.trainStatusByNumber,
      trainTypeLabels: this.masterData.trainTypeLabels,
      stationNames: this.masterData.stationNames,
    })
  }
}

// The service day boundary is JST midnight. Relies on TZ=Asia/Tokyo being
// set for the process (see composeDepartures.ts) — local getFullYear/
// getMonth/getDate then read JST directly. (toISOString() is NOT used here:
// it's always UTC regardless of TZ, which would misclassify the ~1-9am JST
// window as the previous day.)
function dateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test departureBoardState.test`
Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/state/departureBoardState.ts packages/server/src/state/departureBoardState.test.ts
git commit -m "feat: add DepartureBoardState orchestrator for cache lifecycle"
```

---

### Task 9: Hono `GET /departures` route

**Files:**
- Create: `packages/server/src/api/departuresRoute.ts`
- Create: `packages/server/src/api/departuresRoute.test.ts`

**Interfaces:**
- Consumes: `DepartureView` (Task 7), `TrackConfig` (Task 2)
- Produces: `interface DeparturesSource { getDepartures(now: Date, offsetMinutes: number): DepartureView[] }`, `createDeparturesRoute(source: DeparturesSource, config: TrackConfig): Hono`

The route depends on a small `DeparturesSource` interface rather than the concrete `DepartureBoardState` class, so it's testable with a plain stub object.

- [ ] **Step 1: Write the failing test**

Create `packages/server/src/api/departuresRoute.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createDeparturesRoute, type DeparturesSource } from './departuresRoute.js'
import { AKABANE_TRACK_3 } from '../config/track.js'
import type { DepartureView } from '../departures/composeDepartures.js'

function stubSource(trains: DepartureView[], shouldThrow = false): DeparturesSource {
  return {
    getDepartures: () => {
      if (shouldThrow) throw new Error('Master data not loaded yet')
      return trains
    },
  }
}

describe('GET /departures', () => {
  it('returns the composed trains with platform metadata', async () => {
    const trains: DepartureView[] = [
      { trainType: '普通', destination: '上野', carComposition: 15, scheduledTime: '19:08', delaySeconds: 0 },
    ]
    const route = createDeparturesRoute(stubSource(trains), AKABANE_TRACK_3)

    const res = await route.request('/departures?offset=5')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.trains).toEqual(trains)
    expect(body.platform).toEqual({
      label: '3',
      lineLabel: '上野東京ライン',
      lineBadge: 'JU',
      destinationArea: '上野・東京・横浜方面',
    })
  })

  it('defaults offset to 0 when not provided', async () => {
    const route = createDeparturesRoute(stubSource([]), AKABANE_TRACK_3)
    const res = await route.request('/departures')
    expect(res.status).toBe(200)
  })

  it('rejects an offset outside 0-30', async () => {
    const route = createDeparturesRoute(stubSource([]), AKABANE_TRACK_3)
    const res = await route.request('/departures?offset=31')
    expect(res.status).toBe(400)
  })

  it('returns 503 when the source is not ready yet', async () => {
    const route = createDeparturesRoute(stubSource([], true), AKABANE_TRACK_3)
    const res = await route.request('/departures')
    expect(res.status).toBe(503)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server test departuresRoute.test`
Expected: FAIL with "Cannot find module './departuresRoute.js'"

- [ ] **Step 3: Implement**

Create `packages/server/src/api/departuresRoute.ts`:

```ts
import { Hono } from 'hono'
import type { DepartureView } from '../departures/composeDepartures.js'
import type { TrackConfig } from '../config/track.js'

export interface DeparturesSource {
  getDepartures(now: Date, offsetMinutes: number): DepartureView[]
}

export function createDeparturesRoute(source: DeparturesSource, config: TrackConfig): Hono {
  const route = new Hono()

  route.get('/departures', (c) => {
    const offsetParam = c.req.query('offset') ?? '0'
    const offsetMinutes = Number(offsetParam)
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 30) {
      return c.json({ error: 'offset must be a number between 0 and 30' }, 400)
    }

    try {
      const trains = source.getDepartures(new Date(), offsetMinutes)
      return c.json({
        generatedAt: new Date().toISOString(),
        platform: {
          label: config.platformLabel,
          lineLabel: config.lineLabel,
          lineBadge: config.lineBadge,
          destinationArea: config.destinationArea,
        },
        trains,
      })
    } catch {
      return c.json({ error: 'not ready' }, 503)
    }
  })

  return route
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter server test departuresRoute.test`
Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/departuresRoute.ts packages/server/src/api/departuresRoute.test.ts
git commit -m "feat: add GET /departures Hono route"
```

---

### Task 10: Wire everything into the server + manual verification

**Files:**
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9

- [ ] **Step 1: Wire the app**

Replace the contents of `packages/server/src/index.ts`:

```ts
// ODPT times are always JST wall-clock. Pin the process timezone so
// calendar.ts/composeDepartures.ts/departureBoardState.ts behave correctly
// regardless of the host's own configured timezone (e.g. a Raspberry Pi
// defaulting to UTC). Must be the first line, before any Date is created.
process.env.TZ = 'Asia/Tokyo'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvToken } from './shared/env.js'
import { AKABANE_TRACK_3 } from './config/track.js'
import { loadMasterData } from './odpt/masterData.js'
import { fetchTodaysDepartures } from './schedule/stationTimetableCache.js'
import { fetchTrainStatuses } from './realtime/trainStatusPoller.js'
import { DepartureBoardState } from './state/departureBoardState.js'
import { createDeparturesRoute } from './api/departuresRoute.js'

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(here, '..')

const token = loadEnvToken(serverRoot, 'ODPT_CHALLENGE_TOKEN')
const state = new DepartureBoardState(token, AKABANE_TRACK_3, {
  loadMasterData,
  fetchTodaysDepartures,
  fetchTrainStatuses,
})

const REALTIME_POLL_INTERVAL_MS = 60_000

async function bootstrap() {
  await state.refreshMasterData()
  await state.refreshTodaysDepartures(new Date())
  await state.refreshTrainStatuses()

  setInterval(async () => {
    try {
      if (state.needsDailyRefresh(new Date())) {
        await state.refreshTodaysDepartures(new Date())
      }
      await state.refreshTrainStatuses()
    } catch (err) {
      console.error('refresh failed, keeping previous cache', err)
    }
  }, REALTIME_POLL_INTERVAL_MS)
}

const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/', createDeparturesRoute(state, AKABANE_TRACK_3))

bootstrap()
  .then(() => {
    serve({ fetch: app.fetch, port: 3000 }, (info) => {
      console.log(`Server is running on http://localhost:${info.port}`)
    })
  })
  .catch((err) => {
    console.error('failed to bootstrap departure board state', err)
    process.exitCode = 1
  })
```

- [ ] **Step 2: Run the full test suite**

Run: `pnpm --filter server test`
Expected: all tests from Tasks 1–9 still pass (roughly 21 tests total)

- [ ] **Step 3: Typecheck**

Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manual end-to-end verification**

Run: `pnpm --filter server dev`

Wait for `Server is running on http://localhost:3000` in the log (bootstrap fetches master data + today's timetable + real-time status from ODPT — this hits the live network).

In another terminal:

```bash
curl -s 'http://localhost:3000/departures?offset=0' | head -c 2000
curl -s 'http://localhost:3000/departures?offset=31'  # expect 400
```

Expected: the first call returns JSON with `platform.lineLabel: "上野東京ライン"` and a `trains` array with 0–2 entries (0 if it's currently outside operating hours or the API has no more trains before midnight — see the day-rollover non-goal below); each entry has `trainType`, `destination`, `scheduledTime`, `delaySeconds`, and possibly `carComposition`. The second call returns a 400 with an error message.

Stop the dev server (Ctrl+C) once verified.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: wire ODPT integration layer into the server, expose GET /departures"
```

---

## Known non-goals (explicitly out of scope for this plan)

- **Midnight rollover:** if today's remaining departures run out before midnight, `getDepartures` returns fewer than 2 (or 0) trains rather than pulling from tomorrow's timetable. Not needed for the MVP's commute use case.
- **GTFS static fallback when ODPT is unreachable:** on refresh failure, the previous in-memory cache keeps being served (see Task 10's `catch` block) but there's no secondary data source. Revisit if uptime becomes a problem.
- **Client UI and Electron/RPi packaging:** separate specs/plans (Phase 2 and Phase 3 per the architecture doc).
