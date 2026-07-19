import { Hono } from "hono"
import type { DepartureView } from "../departures/composeDepartures.js"
import type { TrackConfig } from "../config/track.js"

export interface DeparturesSource {
  getDepartures(now: Date, offsetMinutes: number): DepartureView[]
}

/**
 * offset(0〜30分)パラメータを受け取り、composeDeparturesの結果と
 * ホーム表示メタデータをJSONで返すHonoルートを構築する。
 */
export function createDeparturesRoute(source: DeparturesSource, config: TrackConfig): Hono {
  const route = new Hono()

  route.get("/departures", (c) => {
    const offsetParam = c.req.query("offset") ?? "0"
    const offsetMinutes = Number(offsetParam)
    if (!Number.isFinite(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 30) {
      return c.json({ error: "offset must be a number between 0 and 30" }, 400)
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
      return c.json({ error: "not ready" }, 503)
    }
  })

  return route
}
