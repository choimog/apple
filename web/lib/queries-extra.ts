/**
 * 새로 만든 데이터베이스 기능(db/perf.sql)을 부르는 함수들.
 * 기능이 아직 안 켜졌으면 ok:false 를 돌려주고, 화면이 그 사실을 알립니다.
 */

import { db } from "./supabase";

/* ------------------------------------------------------------- 도서 검색 */

export type SearchHit = {
  bookId: number;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYm: string | null;
  coverUrl: string | null;
  isbn13: string | null;
  /** 이 책이 있는 서점 번호 */
  stores: number[];
  /** 마지막으로 순위에 있던 날 (없으면 순위 기록이 없는 책) */
  lastSeen: string | null;
  /** 지금까지 기록한 가장 높은 순위 */
  bestRank: number | null;
};

/**
 * 한 책은 한 줄로 나옵니다.
 *
 * 【왜 바꿨나요? — 2026-08-08 대표님 지적】
 * 예전 검색은 '서점별 도서' 표를 그대로 보여줘서, 같은 책이
 * 교보·예스24·알라딘 세 줄로 나뉘어 나왔습니다. 찾는 사람 입장에서
 * 같은 책이 세 개로 보이는 건 의미가 없습니다.
 */
export async function searchMerged(
  q: string,
  limit = 50
): Promise<{ rows: SearchHit[]; ok: boolean }> {
  const term = q.trim();
  if (!term) return { rows: [], ok: true };

  const { data, error } = await db().rpc("search_books_merged", {
    p_q: term,
    p_limit: limit,
  });
  if (error || !data) return { rows: [], ok: false };

  return {
    ok: true,
    rows: (data as RpcSearchRow[]).map((r) => ({
      bookId: Number(r.book_id),
      title: r.title,
      author: r.author,
      publisher: r.publisher,
      pubYm: r.pub_ym,
      coverUrl: r.cover_url,
      isbn13: r.isbn13,
      stores: (r.stores ?? []).map(Number),
      lastSeen: r.last_seen,
      bestRank: r.best_rank === null ? null : Number(r.best_rank),
    })),
  };
}

type RpcSearchRow = {
  book_id: number | string;
  title: string;
  author: string | null;
  publisher: string | null;
  pub_ym: string | null;
  cover_url: string | null;
  isbn13: string | null;
  stores: number[] | null;
  last_seen: string | null;
  best_rank: number | null;
};

/* ------------------------------------------------ 하루치 수집 상세 (분야별) */

export type CrawlDetailRow = {
  storeId: number;
  categoryId: number | null;
  /** 화면에 보여줄 이름 — 분야 이름 또는 매장 이름 */
  name: string;
  kind: string | null;
  status: string;
  items: number;
  expected: number | null;
  error: string | null;
  finishedAt: string | null;
};

/**
 * 어느 날, 어느 분야가 성공했고 어느 분야가 실패했는지.
 *
 * 【왜 필요한가요? — 2026-08-08 대표님 요청】
 * "수집 실패한 데이터는 수집상태에서 어디어디가 실패했는지 클릭하면
 *  리포트가 나오게 해줘."
 * 예전 화면은 서점별 성공/실패 '개수' 만 보여줬습니다. 개수만 봐서는
 * 무엇을 고쳐야 할지 알 수 없습니다.
 *
 * ※ 데이터베이스 계산 기능(perf.sql)이 없어도 동작합니다.
 */
export async function getCrawlDetail(date: string): Promise<CrawlDetailRow[]> {
  const { data, error } = await db()
    .from("crawl_logs")
    .select(
      `store_id, category_id, status, items_collected, items_expected,
       error_message, finished_at,
       category:categories ( name, kind, branch_name )`
    )
    .eq("snapshot_date", date)
    .order("store_id")
    .order("id");
  if (error) throw error;

  type Row = {
    store_id: number;
    category_id: number | null;
    status: string;
    items_collected: number | null;
    items_expected: number | null;
    error_message: string | null;
    finished_at: string | null;
    category: { name: string; kind: string; branch_name: string | null } | null;
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    storeId: r.store_id,
    categoryId: r.category_id,
    name:
      r.category?.branch_name ||
      r.category?.name ||
      (r.category_id ? `분야 ${r.category_id}` : "분야 정보 없음"),
    kind: r.category?.kind ?? null,
    status: r.status,
    items: r.items_collected ?? 0,
    expected: r.items_expected,
    error: r.error_message,
    finishedAt: r.finished_at,
  }));
}

/* ----------------------------------------------------------- 수집 상태 */

export type CrawlDay = {
  date: string;
  storeId: number;
  ok: number;
  failed: number;
  items: number;
  startedAt: string | null;
  finishedAt: string | null;
};

/** 서점별로 언제 시작해 언제 끝났는지 (분까지) */
export async function getCrawlSummary(
  days = 7
): Promise<{ rows: CrawlDay[]; ok: boolean }> {
  const { data, error } = await db().rpc("crawl_summary", { p_days: days });
  if (error || !data) return { rows: [], ok: false };
  return {
    ok: true,
    rows: (
      data as {
        snapshot_date: string;
        store_id: number;
        ok_count: number;
        fail_count: number;
        items: number | string;
        started_at: string | null;
        finished_at: string | null;
      }[]
    ).map((r) => ({
      date: r.snapshot_date,
      storeId: r.store_id,
      ok: r.ok_count,
      failed: r.fail_count,
      items: Number(r.items ?? 0),
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    })),
  };
}
