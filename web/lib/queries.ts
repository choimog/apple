/**
 * 데이터베이스에서 화면에 필요한 값을 꺼내오는 함수 모음.
 *
 * 【중요한 원칙】
 * 값이 없으면 없는 대로 보여줍니다. 지어내지 않습니다.
 * 수집이 실패한 날은 그 날짜가 아예 안 나옵니다 (가짜로 채우지 않음).
 */

import { supabase } from "./supabase";

export type Category = {
  id: number;
  store_id: number;
  name: string;
  kind: string;
  branch_name: string;
  code: string;
};

export type RankingRow = {
  rank: number;
  sales_point: number | null;
  store_book: {
    id: number;
    store_id: number;
    raw_title: string;
    raw_author: string | null;
    raw_publisher: string | null;
    pub_ym: string | null;
    cover_url: string | null;
    isbn13: string | null;
    book_id: number | null;
  };
  /** 어제 대비 등락. 어제 데이터가 없으면 null (지어내지 않음) */
  change: number | null;
  isNew: boolean;
};

/**
 * 수집된 날짜 목록 (최신순). 수집이 실패한 날은 여기 없습니다.
 *
 * ※ 순위표는 하루에 수천 행씩 쌓입니다. 그런데 데이터베이스는 한 번에
 *   1,000행까지만 돌려주므로, 그냥 읽으면 "최근 하루치" 밖에 못 봅니다.
 *   그래서 필요한 날짜 개수가 모일 때까지 나눠서 읽습니다.
 */
export async function getSnapshotDates(limit = 60): Promise<string[]> {
  const seen = new Set<string>();
  const step = 1000;
  let start = 0;

  // 안전장치: 아무리 많아도 20번(=2만 행)까지만 읽습니다
  for (let page = 0; page < 20 && seen.size < limit; page += 1) {
    const { data, error } = await supabase
      .from("rankings")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .range(start, start + step - 1);
    if (error) throw error;

    const rows = data ?? [];
    for (const r of rows) seen.add(r.snapshot_date as string);
    if (rows.length < step) break;
    start += step;
  }

  return [...seen].slice(0, limit);
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id,store_id,name,kind,branch_name,code")
    .eq("enabled", true)
    .order("store_id")
    .order("kind")
    .order("branch_name")
    .order("id");
  if (error) throw error;
  return (data ?? []) as Category[];
}

const RANKING_COLUMNS = `
  rank,
  sales_point,
  store_book:store_books!inner (
    id, store_id, raw_title, raw_author, raw_publisher,
    pub_ym, cover_url, isbn13, book_id
  )
`;

/** 특정 날짜·분야의 순위표. 어제와 비교해 등락도 함께 계산합니다. */
export async function getRankings(
  categoryId: number,
  date: string,
  limit = 100
): Promise<RankingRow[]> {
  const { data, error } = await supabase
    .from("rankings")
    .select(RANKING_COLUMNS)
    .eq("category_id", categoryId)
    .eq("snapshot_date", date)
    .order("rank")
    .limit(limit);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Omit<RankingRow, "change" | "isNew">[];

  // ---- 등락 계산: 바로 이전 수집일과 비교 ----
  const prevDate = await getPreviousDate(categoryId, date);
  const prevRank = new Map<number, number>();
  if (prevDate) {
    const { data: prev } = await supabase
      .from("rankings")
      .select("rank, store_book_id")
      .eq("category_id", categoryId)
      .eq("snapshot_date", prevDate);
    for (const p of prev ?? []) {
      prevRank.set(p.store_book_id as number, p.rank as number);
    }
  }

  return rows.map((r) => {
    const before = prevRank.get(r.store_book.id);
    return {
      ...r,
      // 어제 데이터 자체가 없으면 등락을 계산할 수 없습니다 → null
      change: prevDate && before !== undefined ? before - r.rank : null,
      isNew: !!prevDate && before === undefined,
    };
  });
}

/** 이 분야에서 주어진 날짜 '바로 앞' 수집일을 찾습니다. */
export async function getPreviousDate(
  categoryId: number,
  date: string
): Promise<string | null> {
  const { data } = await supabase
    .from("rankings")
    .select("snapshot_date")
    .eq("category_id", categoryId)
    .lt("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  return (data?.[0]?.snapshot_date as string) ?? null;
}

/** 제목·저자·출판사로 찾기 */
export async function searchBooks(q: string, limit = 60) {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  const { data, error } = await supabase
    .from("store_books")
    .select(
      "id,store_id,raw_title,raw_author,raw_publisher,pub_ym,cover_url,isbn13,book_id"
    )
    .or(
      `raw_title.ilike.${like},raw_author.ilike.${like},raw_publisher.ilike.${like}`
    )
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** 한 권의 3사 순위 이력 */
export async function getBookHistory(bookId: number) {
  const { data: sbs } = await supabase
    .from("store_books")
    .select(
      "id,store_id,raw_title,raw_author,raw_publisher,pub_ym,cover_url,isbn13"
    )
    .eq("book_id", bookId);

  const ids = (sbs ?? []).map((s) => s.id as number);
  if (!ids.length) return { stores: [], history: [] };

  const { data: hist } = await supabase
    .from("rankings")
    .select("snapshot_date,rank,sales_point,store_book_id,category_id")
    .in("store_book_id", ids)
    .order("snapshot_date", { ascending: true })
    .limit(2000);

  return { stores: sbs ?? [], history: hist ?? [] };
}

/** 최근 수집이 잘 됐는지 (화면 상단에 정직하게 표시하기 위함) */
export async function getRecentCrawlStatus(limit = 12) {
  const { data } = await supabase
    .from("crawl_logs")
    .select("snapshot_date,store_id,status,items_collected,error_message")
    .order("id", { ascending: false })
    .limit(limit);
  return data ?? [];
}
