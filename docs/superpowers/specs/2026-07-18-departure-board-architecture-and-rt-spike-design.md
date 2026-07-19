# 発車標アプリ 全体アーキテクチャ ＋ Phase 1 (ODPTデータ統合層) 設計

- 日付: 2026-07-18
- 対象ブランチ: `feat/fetch-gtfs-protocolbuf`
- 元ネタ: Obsidian `270718_departure-board要件`

## 背景・要件サマリ

駅の発車案内表示器を再現するReactアプリ。最終的にはRaspberry Pi 4(2GB)上でElectron kiosk modeにより常時表示するミニサイネージにする。

- JR東日本のGTFS対応区間のみを対象とする
- GTFSデータから駅を選択可能にする
- 選択した駅の時刻表データを発車標に反映する
- 時刻表とProtocol Bufferによる列車位置情報を照合し、遅延情報も反映する（既定の発車時刻 ⇔ 遅れXX分、を交互表示）
- 表示される列車は現在時刻基準の直近2列車まで。オフセットを0〜30分後まで設定可能（自宅から駅までの移動時間を考慮）
- 発車標の外枠スタイリングはMVPとして赤羽駅3番線（上野東京ライン）に固定。将来的に他駅対応も見据える
- 技術スタック: TypeScript / React / Hono (Node adapter) / Electron kiosk mode

## Phase 0で判明した事実（実施済み）

`packages/server/src/gtfs/realtime/inspectVehiclePositions.ts` でODPTのGTFS-RT VehiclePositionフィード（`jreast_odpt_train_vehicle`）を実際にデコードした結果：

- `trip_id`は静的GTFSの`trip_id`と同一形式（例: `1121911H`）で突合可能
- **`delay`相当のフィールドは存在しない**（標準GTFS-RT VehiclePositionの仕様通り）
- `currentStopSequence` / `currentStatus` / 位置(lat/lon) / `timestamp`は取得できる
- 種別・両数・行先といった情報はGTFS-RTの仕様自体に存在しない

続けて `packages/server/src/odpt/inspectJsonEndpoints.ts` でODPTのJSON-LD API 5種（`odpt:Train` / `odpt:Station` / `odpt:StationTimetable` / `odpt:Railway` / `odpt:TrainTimetable`）と、追加で`odpt:TrainType`を実際に叩いた結果：

- **`odpt:Train`**（リアルタイム）: `odpt:delay` / `odpt:trainType` / `odpt:carComposition` / `odpt:railDirection` / `odpt:destinationStation` / `odpt:trainNumber` が全て実データとして入っている
- **`odpt:StationTimetable`**: 駅×方向×暦区分ごとに、その日の全便を`odpt:trainType` / `odpt:trainNumber` / `odpt:departureTime` / `odpt:destinationStation`付きで保持している。**GTFS静的データで欠けていた種別・行先情報がそのまま含まれる**
- **`odpt:TrainTimetable`**: 列車ごとの全停車駅時刻表。`odpt:nextTrainTimetable` / `odpt:previousTrainTimetable` で直通運転の前後列車を明示（例: 八高線965E→川越線964H）。**「上野東京ラインは独立routeではなく高崎線/宇都宮線が直通しているだけ」という、GTFS静的側では表現できなかった問題への直接的な解になる**
- **`odpt:TrainType`**: マスタは10件のみ。`dc:title`/`odpt:trainTypeTitle.ja`で日本語ラベルを直接取得できる（例: `JR-East.Local` → `普通`、`JR-East.Rapid` → `快速`）
- **`odpt:Station`**: `geo:lat`/`geo:long`、`odpt:stationCode`（GTFSのstop_code相当、例: `JU04`）、`odpt:connectingRailway`/`odpt:connectingStation`（同一物理駅の別路線側エントリへの相互参照）を持つ
- **赤羽駅3番線（上野東京ライン、駅番号JU04）の実体を特定済み**: `odpt.Station:JR-East.Takasaki.Akabane` と `odpt.Station:JR-East.Utsunomiya.Akabane` の**2つのStation ID**が同じ物理ホーム（stationCode: JU04）を指しており、高崎線直通・宇都宮線直通の両方の列車がこのホームから発車する。したがって時刻表取得はこの2つを合成する必要がある
- **暦区分は`Weekday`/`SaturdayHoliday`の2種類のみ**（JR東日本の実データで確認）
- **方向名はrailwayファミリーごとに異なる**（Takasaki/Utsunomiya/ChuoRapid等は`Inbound`/`Outbound`、京浜東北線根岸線は`Northbound`/`Southbound`など）。赤羽3番線（上野・東京・横浜方面）が`Inbound`/`Outbound`のどちらかは未検証（実装着手時に`StationTimetable`の中身の`destinationStation`を見て確定させる）
- **operator全体へのクエリは1000件で打ち切られる**（`StationTimetable`/`TrainTimetable`双方で確認）。本番では`odpt:station=`等で対象を絞った問い合わせになるため実害はない

## 更新後の全体アーキテクチャ（3層）

GTFS静的データのパース層が不要になったため、当初4層だった構成を3層に整理する。

```
┌─────────────────────────────────────────────────────┐
│ ① ODPTデータ取得・統合層 (server)                      │
│   - マスタ(Railway/Station/TrainType)を起動時に取得・キャッシュ │
│   - StationTimetable(赤羽駅3番線・当日の暦区分)を       │
│     1日1回程度取得し、当日の便一覧としてキャッシュ        │
│   - Train(リアルタイム)を短間隔でポーリングし、          │
│     trainNumberで突合、delay/carCompositionを上書き    │
├─────────────────────────────────────────────────────┤
│ ② API層 (Hono)                                        │
│   GET /departures?offset=0-30 → 直近2本をJSONで返す     │
├─────────────────────────────────────────────────────┤
│ ③ 表示層 (React → Electron kiosk → RPi)                │
└─────────────────────────────────────────────────────┘
```

既にダウンロード済みのGTFS静的データ（`packages/server/src/gtfs/static/jreast/`）は今回の実装パスからは外す。将来「ODPT側が落ちた時のオフラインフォールバック」用途で使う可能性はあるが、Phase 1のロジックには組み込まない。

## Phase 1: ODPTデータ取得・統合層 + API 詳細設計

### 1. MVP向け固定設定

赤羽駅3番線（上野東京ライン、JU04）を指す設定を1箇所にまとめる。

```ts
// packages/server/src/config/track.ts （案）
{
  stationIds: [
    'odpt.Station:JR-East.Takasaki.Akabane',
    'odpt.Station:JR-East.Utsunomiya.Akabane',
  ],
  direction: 'Inbound', // 要検証: 上野・東京・横浜方面がInbound/Outboundどちらか
  platformLabel: '3',
  lineLabel: '上野東京ライン',
  lineBadge: 'JU',
  destinationArea: '上野・東京・横浜方面',
}
```

将来他駅対応する場合も、この設定オブジェクトを増やす形で拡張できる想定（今回はこの1エントリのみ実装）。

### 2. コンポーネント構成

- **`odpt/client.ts`**: ODPT呼び出しの共通処理（token付与・fetch・JSON parse）。既存の`inspectJsonEndpoints.ts`のロジックをベースに、クエリパラメータ（`odpt:station=` 等）を渡せる形にする。
- **`odpt/masterData.ts`**: `odpt:TrainType`（10件、種別ID→日本語ラベル）と `odpt:Station`（destinationStationのID→駅名解決用）を起動時に1回取得しメモリ保持。プロセス生存期間中は再取得不要（安全のため1日1回程度のリフレッシュを入れてもよい）。
- **`schedule/calendar.ts`**: 今日の暦区分（`Weekday` / `SaturdayHoliday`）判定ユーティリティ。土日、または日本の祝日なら`SaturdayHoliday`。祝日判定には軽量な祝日判定ライブラリを使う（具体的なパッケージ選定は実装時に行う）。
- **`schedule/stationTimetableCache.ts`**: 設定の2つのstationId × `direction` × 今日の暦区分で`StationTimetable`を取得し、`departureTime`でマージソートした「当日の全便リスト」をメモリキャッシュする。静的な時刻表なので、日付が変わったタイミング（または起動時）にのみ再取得すればよい。
- **`realtime/trainStatusPoller.ts`**: `odpt:Train`を定期ポーリング（railwayで`Takasaki`/`Utsunomiya`にフィルタ）し、`trainNumber`をキーに`delay`/`carComposition`のマップを保持。取得した`odpt:Train`のレスポンスには`dct:valid`（データの有効期限、実測で取得から5分後）が含まれるため、その範囲内で収まる間隔（暫定: 60秒）でポーリングする。
- **`departures/composeDepartures.ts`**: 現在時刻＋オフセットから当日便一覧を絞り込み直近2本を選び、リアルタイムキャッシュをtrainNumberで突合し、`masterData`経由で種別ラベル・行先駅名を解決して表示用オブジェクトを組み立てる。
- **API層 (Hono)**: `GET /departures?offset=0-30` → 上記を呼びJSONで返す。

### 3. レスポンス例

```json
{
  "generatedAt": "2026-07-18T19:05:00+09:00",
  "platform": { "label": "3", "lineLabel": "上野東京ライン", "lineBadge": "JU", "destinationArea": "上野・東京・横浜方面" },
  "trains": [
    {
      "trainType": "普通",
      "carComposition": 15,
      "destination": "小田原",
      "scheduledTime": "19:08",
      "delaySeconds": 0
    },
    {
      "trainType": "普通",
      "carComposition": 15,
      "destination": "上野",
      "scheduledTime": "19:15",
      "delaySeconds": 120
    }
  ]
}
```

`scheduledTime`と`delaySeconds`を両方返し、「既定の発車時刻⇔遅れXX分」の交互表示アニメーションはPhase 2（クライアント側）の責務とする。`odpt:delay`の単位（秒と推定）は実装着手時に実データで再確認する。

### 4. エラー処理・フォールバック方針

- ODPTへのリクエストが失敗した場合: 直前に取得できたキャッシュ（当日時刻表・リアルタイム遅延）をそのまま使い続け、表示を止めない。サーバーログにエラーを出力する。
- 起動直後でまだキャッシュが無い場合のみ、APIは503相当を返す（クライアントはローディング表示）。

### 5. 実装着手時に最初に確認する残課題

1. 赤羽3番線（上野・東京・横浜方面）が`Inbound`/`Outbound`のどちらか（`StationTimetable`の中身の`destinationStation`を見て確定）
2. `odpt:delay`の単位（秒 or 分、符号の向き）
3. `odpt:Train`ポーリング間隔の具体値（60秒を仮置き、実運用しながら調整）
4. 祝日判定ライブラリの選定

## 次のステップ

Phase 1の実装計画（ファイル単位のタスク分解）は、本設計書の承認後にwriting-plansスキルで作成する。クライアントUI（Phase 2相当）・Electron kiosk化/RPi配布（Phase 3相当）は、この後の会話で個別にspec化する。
