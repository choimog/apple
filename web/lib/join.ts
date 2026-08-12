/**
 * 강제로 묶기 — 규칙이 갈라 놓은 책을 사람이 직접 이어 붙이는 기능의 자료.
 *
 * 【2026-08-12 대표님 요청】
 *   "다르다고 매칭된 것 중에 내가 수동으로 이어주고 싶은 게 있거든?
 *    모든 걸 규정화할 수는 없으니까. 내가 강제로 3개를 묶어줄 수 있는
 *    기능을 만들어도 좋을 것 같고."
 *
 * 【왜 검토 화면에서는 못 하나요?】
 * 검토 화면은 **이미 이어진 짝**의 판정을 바꾸는 곳입니다. 규칙이
 * "다른 책" 이라고 한 짝은 아예 저장돼 있지 않아서 고칠 줄이 없습니다.
 * 그래서 여기서는 짝이 아니라 **서점 상품을 직접 찾아서** 고릅니다.
 *
 * 【무엇이 저장되나요?】
 * 고른 상품끼리 모든 짝을 '사람이 같은 책이라고 함(manual_merge)' 으로
 * 남깁니다. 3권을 고르면 짝 3개(A-B, A-C, B-C)가 됩니다.
 * 이 결정은 자동 규칙이 절대 못 뒤집습니다.
 */

import { db } from "./supabase";
// 순수 계산은 시험에서 그대로 불러다 쓸 수 있게 따로 두었습니다
import { JOIN_SEARCH_CAP } from "./join-pairs";

export { JOIN_SEARCH_CAP, MAX_JOIN, pairsOf } from "./join-pairs";

export type JoinBook = {
  id: number;
  storeId: number;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYm: string | null;
  listPrice: number | null;
  isbn13: string | null;
  coverUrl: string | null;
  /** 지금 어느 도서로 묶여 있는지. 같은 번호끼리는 이미 한 책입니다 */
  bookId: number | null;
};

function shape(r: Record<string, unknown>): JoinBook {
  return {
    id: r.id as number,
    storeId: r.store_id as number,
    title: (r.raw_title as string) ?? "(제목 없음)",
    author: (r.raw_author as string) ?? null,
    publisher: (r.raw_publisher as string) ?? null,
    pubYm: (r.pub_ym as string) ?? null,
    listPrice: (r.list_price as number) ?? null,
    isbn13: (r.isbn13 as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    bookId: (r.book_id as number) ?? null,
  };
}

const COLS =
  "id,store_id,raw_title,raw_author,raw_publisher,pub_ym,list_price,isbn13,cover_url,book_id";

/** 제목·저자·출판사로 서점 상품을 찾습니다 */
export async function searchBooksToJoin(q: string): Promise<{
  rows: JoinBook[];
  capped: boolean;
  ok: boolean;
  why?: string;
}> {
  const term = q.trim();
  if (!term) return { rows: [], capped: false, ok: true };

  const like = `%${term}%`;
  const { data, error } = await db()
    .from("store_books")
    .select(COLS)
    .or(
      `raw_title.ilike.${like},raw_author.ilike.${like},raw_publisher.ilike.${like}`
    )
    // 같은 책이 나란히 보이도록 제목 순으로 정렬합니다.
    // 그래야 '집 에디션' 과 '집에디션 리커버' 가 붙어서 나옵니다.
    .order("raw_title")
    .limit(JOIN_SEARCH_CAP + 1);

  if (error) return { rows: [], capped: false, ok: false, why: error.message };

  const all = (data ?? []) as Record<string, unknown>[];
  return {
    rows: all.slice(0, JOIN_SEARCH_CAP).map(shape),
    capped: all.length > JOIN_SEARCH_CAP,
    ok: true,
  };
}

/** 번호로 상품을 읽어옵니다 (누르기 직전에 다시 확인할 때 씁니다) */
export async function booksByIds(ids: number[]): Promise<JoinBook[]> {
  if (!ids.length) return [];
  const { data, error } = await db().from("store_books").select(COLS).in("id", ids);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(shape);
}
