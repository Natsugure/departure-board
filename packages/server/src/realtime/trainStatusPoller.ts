import { fetchOdptResource } from "../odpt/client.js"
import type { OdptTrain } from "../odpt/types.js"

export interface TrainStatus {
  delaySeconds: number
  carComposition?: number
}

/**
 * odpt:Trainから対象路線の遅延・編成情報を取得し、列車番号をキーに返す。
 */
export async function fetchTrainStatuses(
  token: string,
  railwayIds: string[],
): Promise<Map<string, TrainStatus>> {
  const trains = await fetchOdptResource<OdptTrain>(token, "odpt:Train", {
    "odpt:operator": "odpt.Operator:JR-East",
  })

  const result = new Map<string, TrainStatus>()
  for (const train of trains) {
    if (!railwayIds.includes(train["odpt:railway"])) continue
    result.set(train["odpt:trainNumber"], {
      delaySeconds: train["odpt:delay"],
      carComposition: train["odpt:carComposition"],
    })
  }
  return result
}
