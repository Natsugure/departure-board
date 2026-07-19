export interface TrackConfig {
  stationIds: string[]
  railwayIds: string[]
  direction: "Inbound" | "Outbound"
  platformLabel: string
  lineLabel: string
  lineBadge: string
  destinationArea: string
}

export const AKABANE_TRACK_3: TrackConfig = {
  stationIds: [
    "odpt.Station:JR-East.Takasaki.Akabane",
    "odpt.Station:JR-East.Utsunomiya.Akabane",
  ],
  railwayIds: [
    "odpt.Railway:JR-East.Takasaki",
    "odpt.Railway:JR-East.Utsunomiya",
  ],
  direction: "Inbound",
  platformLabel: "3",
  lineLabel: "上野東京ライン",
  lineBadge: "JU",
  destinationArea: "上野・東京・横浜方面",
}
