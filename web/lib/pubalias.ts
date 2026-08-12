/**
 * 출판사 묶기 — "이 둘은 같은 출판사" 를 사람이 정해 두는 기능의 자료.
 *
 * 【2026-08-12 대표님 요청】
 *   "청림Life 랑 청림라이프처럼, 서점마다 출판사를 표기하는 명칭이
 *    조금씩 다른데 이것도 다 규칙화하기 어려울 것 같아서.
 *    지금 규칙으로 나오는 결과가 마음에 들어서 괜히 건드렸다가 꼬이게
 *    하고 싶지 않아서 저런 방식을 따로 만들고 싶은데 어때?"
 *
 * 【이게 하는 일 — 딱 하나입니다】
 * "이 이름과 저 이름은 같은 곳" 이라고 알려 주는 것뿐입니다.
 * 규칙(config/matching.yaml)은 **한 글자도 안 건드립니다.**
 * 순위·점수는 매일 처음부터 다시 계산하므로, 풀면 곧바로 원래대로
 * 돌아갑니다. 쌓이거나 어긋나는 값이 없습니다.
 */

import { db } from "./supabase";

/** 한 무리에 넣을 수 있는 최대 이름 수 */
export const MAX_ALIAS = 8;

/** 찾기에서 훑어볼 서점 상품 수 (많이 볼수록 느려집니다) */
export const ALIAS_SCAN_CAP = 600;

export type PubName = {
  /** 정규화한 이름 — 이것이 저장되는 열쇠입니다 */
  key: string;
  /** 서점이 실제로 적은 표기 중 가장 흔한 것 */
  sample: string;
  /** 이 이름으로 잡혀 있는 서점 상품 수 */
  count: number;
  /** 이미 어느 무리에 들어 있으면 그 대표 이름 */
  canonical: string | null;
};

export type AliasGroup = {
  canonical: string;
  names: { key: string; sample: string | null }[];
};

/** 지금 정해 둔 무리들 */
export async function listAliasGroups(): Promise<{
  groups: AliasGroup[];
  ok: boolean;
  needsSql: boolean;
}> {
  const { data, error } = await db()
    .from("publisher_aliases")
    .select("name,canonical,raw_sample")
    .order("canonical")
    .order("name");

  if (error) {
    // 표가 아직 없으면 "SQL 을 돌리세요" 라고 알려야 합니다.
    // 그냥 '없음' 으로 보이면 대표님은 왜 안 되는지 알 수 없습니다.
    const missing = /does not exist|schema cache|relation/i.test(error.message);
    return { groups: [], ok: false, needsSql: missing };
  }

  const by = new Map<string, AliasGroup>();
  for (const r of data ?? []) {
    const c = r.canonical as string;
    if (!by.has(c)) by.set(c, { canonical: c, names: [] });
    by.get(c)!.names.push({
      key: r.name as string,
      sample: (r.raw_sample as string) ?? null,
    });
  }
  return { groups: [...by.values()], ok: true, needsSql: false };
}

/**
 * 출판사 이름 찾기.
 *
 * 【왜 서점 상품을 훑나요?】
 * 출판사 이름만 따로 모아 둔 표가 없습니다. 서점 상품(store_books)에
 * 적힌 것이 전부입니다. 그래서 거기서 찾아 세어 올립니다.
 *
 * ⚠️ 데이터베이스가 세어 주지 않으므로 여기서 셉니다. 그래서 훑는 수에
 *    상한이 있고, **넘치면 화면에 "더 있습니다" 라고 적습니다.**
 */
export async function searchPublisherNames(q: string): Promise<{
  rows: PubName[];
  capped: boolean;
  ok: boolean;
}> {
  const term = q.trim();
  if (!term) return { rows: [], capped: false, ok: true };

  const like = `%${term}%`;
  const { data, error } = await db()
    .from("store_books")
    .select("norm_publisher,raw_publisher")
    .ilike("raw_publisher", like)
    .limit(ALIAS_SCAN_CAP + 1);
  if (error) return { rows: [], capped: false, ok: false };

  const all = (data ?? []) as Record<string, unknown>[];
  const capped = all.length > ALIAS_SCAN_CAP;
  const use = all.slice(0, ALIAS_SCAN_CAP);

  // 정규화한 이름별로 모으고, 서점이 적은 표기 중 가장 흔한 것을 고릅니다
  const counts = new Map<string, Map<string, number>>();
  for (const r of use) {
    const key = (r.norm_publisher as string) ?? "";
    const raw = ((r.raw_publisher as string) ?? "").trim();
    if (!key || !raw) continue;
    if (!counts.has(key)) counts.set(key, new Map());
    const m = counts.get(key)!;
    m.set(raw, (m.get(raw) ?? 0) + 1);
  }

  // 이미 무리에 들어 있는지 표시합니다
  const keys = [...counts.keys()];
  const taken = new Map<string, string>();
  if (keys.length) {
    const { data: al } = await db()
      .from("publisher_aliases")
      .select("name,canonical")
      .in("name", keys);
    for (const r of al ?? []) taken.set(r.name as string, r.canonical as string);
  }

  const rows: PubName[] = [...counts.entries()].map(([key, forms]) => {
    let sample = "";
    let best = -1;
    let total = 0;
    for (const [raw, n] of forms) {
      total += n;
      if (n > best || (n === best && raw.length < sample.length)) {
        sample = raw;
        best = n;
      }
    }
    return { key, sample, count: total, canonical: taken.get(key) ?? null };
  });

  rows.sort((a, b) => b.count - a.count || a.sample.localeCompare(b.sample));
  return { rows, capped, ok: true };
}
