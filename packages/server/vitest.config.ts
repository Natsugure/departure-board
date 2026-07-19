import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    /** ODPTは常にJSTなので、テストワーカーのタイムゾーンを固定する。
     * これにより、日付・時刻のロジックが、ホストマシンの設定されたタイムゾーンに関係なく、
     * CI環境でも本番環境の Raspberry Pi と同じ動作をするようになる。
     */
    env: { TZ: "Asia/Tokyo"}
  }
})