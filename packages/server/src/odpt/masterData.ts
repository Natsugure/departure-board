import { fetchOdptResource } from "./client.js"
import type { OdptTrainType, OdptStation } from "./types.js"

export interface MasterData {
  trainTypeLabels: Map<string, string>
  stationNames: Map<string, string>
}

/**
 * 列車種別ラベルと駅名のマスターデータをowl:sameAsをキーに取得する。
 */
export async function loadMasterData(token: string): Promise<MasterData> {
  const [trainTypes, stations] = await Promise.all([
    fetchOdptResource<OdptTrainType>(token, "odpt:TrainType", {
      "odpt:operator": "odpt.Operator:JR-East",
    }),
    fetchOdptResource<OdptStation>(token, "odpt:Station", {
      "odpt:operator": "odpt.Operator:JR-East",
    }),
  ])

  return {
    trainTypeLabels: new Map(trainTypes.map((t) => [t["owl:sameAs"], t["dc:title"]])),
    stationNames: new Map(stations.map((s) => [s["owl:sameAs"], s["dc:title"]])),
  }
}
