/**
 * 즐겨찾기 — 회원마다 자기가 고른 도서만 모아 보기.
 *
 * 【2026-08-18 대표님 요청】
 *   "각 아이디 이용자마다 도서를 즐겨찾기 할 수 있는 기능을 하나 추가할 수
 *    있을까? 즐겨찾기한 도서는 종합탭에 있는 것처럼, 내가 선택한 도서들의
 *    3사 자료가 보이게끔.
 *    그리고 즐겨찾기 목록에 있는 도서가 장기간 업데이트가 안 돼서 지워질
 *    경우, 그 이용자에게 매일 어떤 도서가 지워졌다고 안내문 정도만 남길 수
 *    있나?"
 *
 * 🚨 【남의 즐겨찾기는 여기서 막는 게 아닙니다】
 * 이 파일은 `user_id` 조건을 따로 안 붙입니다. 데이터베이스가
 * (db/favorites.sql 의 보안 규칙) 자기 줄만 보여주기 때문입니다.
 * 화면 코드에서 조건 하나가 빠지면 조용히 새어 나가는데, 그건 눈에
 * 안 보입니다. 진짜 자물쇠는 데이터베이스 쪽에 둡니다.
 * (tests/test_favorites_sql.sh 가 진짜 데이터베이스로 매번 확인합니다)
 */

import { db, currentUser } from "./supabase";
import { fillStoreInfo, type CombinedRow, type Period } from "./queries";

export type FavoriteRow = {
  id: number;
  bookId: number | null;
  title: string;
  author: string | null;
  publisher: string | null;
  /** 자료 정리로 책이 사라진 시각. 없으면 멀쩡히 있는 것입니다 */
  removedAt: string | null;
  /** 안내문을 확인하신 시각 */
  noticedAt: string | null;
};

/** db/favorites.sql 을 아직 실행 안 했을 때 나오는 오류인가 */
function needsSetup(message: string | undefined): boolean {
  const m = (message ?? "").toLowerCase();
  return m.includes("favorites") || m.includes("does not exist") || m.includes("schema cache");
}

/**
 * 내 즐겨찾기 전부.
 *
 * `needsSql` 이면 db/favorites.sql 을 아직 안 돌린 것입니다.
 * 조용히 빈 목록을 보여주면 "담은 게 안 담겼나?" 하고 헤매시게 됩니다.
 */
export async function myFavorites(): Promise<{
  rows: FavoriteRow[];
  needsSql: boolean;
  ok: boolean;
}> {
  const user = await currentUser();
  if (!user) return { rows: [], needsSql: false, ok: false };

  const { data, error } = await db()
    .from("favorites")
    .select("id,book_id,title,author,publisher,removed_at,noticed_at")
    .order("added_at", { ascending: false });

  if (error) {
    return { rows: [], needsSql: needsSetup(error.message), ok: false };
  }
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id as number,
      bookId: (r.book_id as number) ?? null,
      title: (r.title as string) ?? "",
      author: (r.author as string) ?? null,
      publisher: (r.publisher as string) ?? null,
      removedAt: (r.removed_at as string) ?? null,
      noticedAt: (r.noticed_at as string) ?? null,
    })),
    needsSql: false,
    ok: true,
  };
}

/**
 * 번호만 바뀐 책을 다시 이어 줍니다.
 *
 * 🚨 【이게 없으면 거짓 안내문이 매일 뜹니다】
 * [도서 매칭] 은 묶음이 바뀌면 도서 번호를 새로 매깁니다. 2026-08-18
 * 실행에서만 552종이 그랬습니다. 자료가 없어진 것이 아니라 번호만 바뀐
 * 것인데, 그것까지 "지워졌습니다" 라고 알리면 **진짜 안내문을 아무도
 * 안 보게 됩니다.**
 *
 * 이름이 정확히 같은 책이 **딱 하나일 때만** 잇습니다 (db/favorites.sql).
 */
export async function relinkFavorites(): Promise<number> {
  const { data, error } = await db().rpc("relink_my_favorites");
  if (error) return 0;
  return Number(data ?? 0);
}

/** 이 책을 담아 두셨는가 (도서 상세의 별표가 쓰는 값) */
export async function isFavorite(bookId: number): Promise<boolean | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await db()
    .from("favorites")
    .select("id")
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) return null;      // 표가 아직 없으면 '모른다' 로 둡니다
  return !!data;
}

export async function addFavorite(book: {
  id: number;
  title: string;
  author: string | null;
  publisher: string | null;
}): Promise<{ ok: boolean; needsSql: boolean }> {
  const user = await currentUser();
  if (!user) return { ok: false, needsSql: false };

  const { error } = await db().from("favorites").insert({
    user_id: user.id,
    book_id: book.id,
    // 책이 지워진 뒤에도 무엇이었는지 알 수 있게 함께 적어 둡니다.
    title: book.title,
    author: book.author,
    publisher: book.publisher,
  });
  // 이미 담아 두신 책이면 성공으로 봅니다 (버튼을 두 번 누르신 것뿐입니다)
  if (error && error.code === "23505") return { ok: true, needsSql: false };
  return { ok: !error, needsSql: error ? needsSetup(error.message) : false };
}

export async function removeFavorite(bookId: number): Promise<boolean> {
  const { error } = await db().from("favorites").delete().eq("book_id", bookId);
  return !error;
}

/** 사라진 책 줄을 목록에서 아예 뺍니다 (안내문을 보신 뒤) */
export async function removeGone(id: number): Promise<boolean> {
  const { error } = await db().from("favorites").delete().eq("id", id);
  return !error;
}

/** 안내문 확인 — 다음부터는 띠가 안 뜹니다 */
export async function markNoticed(): Promise<boolean> {
  const { error } = await db()
    .from("favorites")
    .update({ noticed_at: new Date().toISOString() })
    .is("noticed_at", null)
    .not("removed_at", "is", null);
  return !error;
}

/**
 * 즐겨찾기한 책들의 3사 자료 — 종합 화면과 **같은 모양**으로.
 *
 * ⚠️ 순위가 하나도 없는 책도 줄을 돌려줍니다. 담아 두신 책이 목록에서
 *    소리 없이 사라지면 안 됩니다. 그럴 때 storeCount 는 0,
 *    avgRank 는 null 입니다 (0 으로 채우지 않습니다).
 */
export async function favoriteRows(
  bookIds: number[],
  date: string,
  period: Period,
  unified: string,
  depth: number
): Promise<{ rows: CombinedRow[]; ok: boolean }> {
  if (!bookIds.length) return { rows: [], ok: true };

  const { data, error } = await db().rpc("books_by_ids", {
    p_ids: bookIds,
    p_date: date,
    p_period: period,
    p_unified: unified,
    p_depth: depth,
  });
  if (error || !data) return { rows: [], ok: false };

  const rows = (data as {
    book_id: number;
    title: string;
    author: string | null;
    publisher: string | null;
    cover_url: string | null;
    store_count: number;
    avg_rank: number | null;
    ranks: Record<string, number> | null;
    sales: Record<string, number> | null;
  }[]).map((r) => ({
    bookId: Number(r.book_id),
    title: r.title,
    author: r.author,
    publisher: r.publisher,
    coverUrl: r.cover_url,
    ranks: numberMap(r.ranks),
    sales: numberMap(r.sales),
    storeCount: r.store_count,
    // 🚨 순위가 없으면 null 입니다. 0 으로 바꾸면 화면에 '0.0위' 가 찍힙니다.
    avgRank: r.avg_rank === null ? null : Number(r.avg_rank),
    listPrice: null as number | null,
    linked: [] as number[],
  }));

  await fillStoreInfo(rows);

  // 순위가 좋은 것부터. 순위가 없는 책은 맨 뒤로 보냅니다 (빼지 않습니다).
  rows.sort(
    (x, y) =>
      (x.avgRank ?? Infinity) - (y.avgRank ?? Infinity) ||
      y.storeCount - x.storeCount ||
      x.title.localeCompare(y.title)
  );
  return { rows, ok: true };
}

/** { "1": 5 } → { 1: 5 }. 값이 없으면 빈 것으로 둡니다 (0 으로 안 채웁니다) */
function numberMap(v: Record<string, number> | null): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, n] of Object.entries(v ?? {})) {
    if (n !== null && n !== undefined) out[Number(k)] = Number(n);
  }
  return out;
}
