const ODPT_BASE_URL = "https://api-challenge.odpt.org/api/v4"

/**
 * ODPT APIから指定したリソースを取得する。
 * クエリ文字列はkey=valueの単純結合で構築し、acl:consumerKeyを末尾に付与する。
 */
export async function fetchOdptResource<T>(
  token: string,
  resourceType: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const paramPairs = Object.entries(params).map(([key, value]) => `${key}=${value}`)
  paramPairs.push(`acl:consumerKey=${token}`)
  const url = `${ODPT_BASE_URL}/${resourceType}?${paramPairs.join("&")}`

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`ODPT request failed: ${resourceType} ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T[]>
}
