// ODPTの時刻は常にJST壁時計文字列のため、ホストマシンの設定タイムゾーンに関わらず
// calendar.ts/composeDepartures.ts/departureBoardState.tsが正しく動作するよう、
// プロセスのタイムゾーンをここで固定する（Dateを生成するどの行よりも先に実行する必要がある）。
process.env.TZ = "Asia/Tokyo"

import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadEnvToken } from "./shared/env.js"
import { AKABANE_TRACK_3 } from "./config/track.js"
import { loadMasterData } from "./odpt/masterData.js"
import { fetchTodaysDepartures } from "./schedule/stationTimetableCache.js"
import { fetchTrainStatuses } from "./realtime/trainStatusPoller.js"
import { DepartureBoardState } from "./state/departureBoardState.js"
import { createDeparturesRoute } from "./api/departuresRoute.js"

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(here, "..")

const token = loadEnvToken(serverRoot, "ODPT_CHALLENGE_TOKEN")
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
      console.error("refresh failed, keeping previous cache", err)
    }
  }, REALTIME_POLL_INTERVAL_MS)
}

const app = new Hono()

app.get("/", (c) => {
  return c.text("Hello Hono!")
})

app.route("/", createDeparturesRoute(state, AKABANE_TRACK_3))

bootstrap()
  .then(() => {
    serve({ fetch: app.fetch, port: 3000 }, (info) => {
      console.log(`Server is running on http://localhost:${info.port}`)
    })
  })
  .catch((err) => {
    console.error("failed to bootstrap departure board state", err)
    process.exitCode = 1
  })
