/**
 * 데이터베이스에서 화면에 필요한 값을 꺼내오는 함수 모음.
 *
 * 【중요한 원칙】
 * 값이 없으면 없는 대로 보여줍니다. 지어내지 않습니다.
 * 수집이 실패한 날은 그 날짜가 아예 안 나옵니다 (가짜로 채우지 않음).
 *
 * 【데이터베이스는 한 번에 1,000행까지만 돌려줍니다】
 * 그 이상이 필요하면 반드시 나눠서 읽어야 합니다.
 * 이걸 놓쳐서 "5,186건 중 158건만 처리" 하는 버그가 실제로 났었습니다.
 * 아래 selectAll() 이 그 처리를 대신합니다.
 */

import { db } from "./supabase";

// 글자만 있는 값들은 따로 두고, 여기서 다시 내보냅니다.
// (예전처럼 "@/lib/queries" 에서 가져다 쓰는 코드가 그대로 돌게)
import { periodOf, type Period } from "./period";
export * from "./period";

/** 분야(카테고리). DB 의 categories 표 한 줄. */
export type Category = {
  id: number;
  store_id: number;
  name: string;
  /** 'online'=온라인 일간 | 'offline'=매장 일간 | 'weekly'=최근 7일 주간 */
  kind: string;
  branch_name: string;
  branch_code: string;
  code: string;
  unified_code: string | null;
};

export type StoreBook = {
  id: number;
  store_id: number;
  raw_title: string;
  raw_author: string | null;
  raw_publisher: string | null;
  pub_ym: string | null;
  /**
   * 정가 — 도서정가제상 출판사가 정한 하나의 값입니다.
   * 3사가 같아야 정상이고, 다르면 다른 판형입니다.
   * (2026-08-11 부터 걷습니다. 그 전 자료에는 없어서 null 입니다)
   */
  list_price: number | null;
  /** 실제 판매가. 서점마다 할인율이 달라 다를 수 있습니다 */
  sale_price: number | null;
  cover_url: string | null;
  isbn13: string | null;
  book_id: number | null;
};

export type RankingRow = {
  rank: number;
  sales_point: number | null;
  store_book: StoreBook;
  /** 어제 대비 등락. 어제 데이터가 없으면 null (지어내지 않음) */
  change: number | null;
  isNew: boolean;
};

/**
 * 1,000행 제한을 넘겨 전부 읽어옵니다.
 * maxRows 를 넘으면 거기서 멈춥니다 (화면이 감당 못 할 양을 막는 안전장치).
 */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  maxRows = 20000
): Promise<T[]> {
  const step = 1000;
  const out: T[] = [];
  for (let start = 0; start < maxRows; start += step) {
    const { data, error } = await build(start, start + step - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

/**
 * 수집된 날짜 목록 (최신순). 수집이 실패한 날은 여기 없습니다.
 *
 * ※ 순위표는 하루에 수만 행씩 쌓입니다. 그런데 데이터베이스는 한 번에
 *   1,000행까지만 돌려주므로, 그냥 읽으면 "최근 하루치" 밖에 못 봅니다.
 *   그래서 필요한 날짜 개수가 모일 때까지 나눠서 읽습니다.
 */
export async function getSnapshotDates(limit = 60): Promise<string[]> {
  // ---- 빠른 길: 데이터베이스가 날짜만 뽑아 줍니다 (db/perf.sql) ----
  // 순위표가 아무리 커져도 날짜 개수만큼만 봅니다.
  const fast = await db().rpc("snapshot_dates", { n: limit });
  if (!fast.error && fast.data) {
    return (fast.data as { snapshot_date: string }[]).map((r) => r.snapshot_date);
  }

  // ---- 느린 길: db/perf.sql 을 아직 실행하지 않았을 때 ----
  // 순위표를 1,000줄씩 읽어 날짜를 모읍니다. 데이터가 쌓일수록 느려집니다.
  // (이 길로 오면 화면 아래에 "속도 개선을 켜세요" 안내가 나옵니다)
  const seen = new Set<string>();
  const step = 1000;
  let start = 0;

  // 안전장치: 아무리 많아도 10번(=1만 행)까지만 읽습니다.
  // 예전엔 40번이었는데, 하루 11만 줄이 쌓이면서 그것만으로 화면이
  // 10초 넘게 멈췄습니다. (2026-08-08)
  for (let page = 0; page < 10 && seen.size < limit; page += 1) {
    const { data, error } = await db()
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
  const { data, error } = await db()
    .from("categories")
    .select("id,store_id,name,kind,branch_name,branch_code,code,unified_code")
    .eq("enabled", true)
    .order("store_id")
    .order("kind")
    .order("branch_name")
    .order("id");
  if (error) throw error;
  return (data ?? []) as Category[];
}

// ---------------------------------------------------------------------------
//  분야 목록을 '고를 수 있는 모양' 으로 정리
// ---------------------------------------------------------------------------

export type StoreTree = {
  storeId: number;
  /** 온라인 분야 (일간) */
  daily: Category[];
  /** 온라인 분야 (주간) */
  weekly: Category[];
  /** 교보 매장별 (매장 이름 순) */
  branches: Category[];
};

/**
 * 종합(전체) 분야를 맨 앞으로.
 *
 * 【왜 필요한가요? — 2026-08-08 대표님 지적】
 * "자꾸 알라딘 온라인일간에서 종합이 안 보이네."
 *
 * 분야 목록은 데이터베이스에 등록된 차례(번호순)로 보여줬습니다. 그런데
 * 알라딘 종합은 수집 주소가 바뀌면서 나중에 다시 등록돼서, 번호가 다른
 * 분야보다 훨씬 큽니다. 그래서 목록 맨 끝으로 밀렸고, 목록 상자는 높이가
 * 정해져 있어 스크롤해야만 보였습니다.
 *
 * 번호와 상관없이 '종합' 을 항상 맨 앞에 둡니다. 가장 많이 보는 분야이므로
 * 첫 번째로 보이는 것이 맞고, 앞으로 주소가 또 바뀌어도 밀리지 않습니다.
 */
function overallFirst(list: Category[]): Category[] {
  return [...list].sort((a, b) => {
    const ao = a.unified_code === "all" ? 0 : 1;
    const bo = b.unified_code === "all" ? 0 : 1;
    return ao !== bo ? ao - bo : a.id - b.id;
  });
}

/**
 * 서점 → 기간 → 분야 의 3단계로 고를 수 있게 분류합니다.
 *
 * 예전에는 208개를 한 줄에 전부 늘어놓아서 원하는 분야를 찾을 수 없었습니다.
 */
export function buildStoreTree(cats: Category[]): StoreTree[] {
  const ids = [...new Set(cats.map((c) => c.store_id))].sort((a, b) => a - b);
  return ids.map((storeId) => {
    const mine = cats.filter((c) => c.store_id === storeId);
    return {
      storeId,
      daily: overallFirst(mine.filter((c) => c.kind === "online")),
      weekly: overallFirst(mine.filter((c) => c.kind === "weekly")),
      branches: mine
        .filter((c) => c.kind === "offline")
        .sort((a, b) => a.branch_name.localeCompare(b.branch_name, "ko")),
    };
  });
}

/**
 * 여러 책의 정가를 한 번에 읽어옵니다. 돌려주는 값: {책번호 → 정가}
 *
 * 【왜 따로 읽나요? — 2026-08-11 대표님 요청】
 * "웰컴·종합·서점별·출판사·작가·검색에도 정가를 보여 달라"
 *
 * 이 화면들은 데이터베이스 함수(db/perf.sql)가 계산해 준 결과를 씁니다.
 * 그 함수에 정가를 넣으려면 대표님이 SQL 을 또 실행하셔야 합니다.
 * 화면에 보이는 것은 100줄뿐이니, 그 100권의 정가만 따로 물어보면
 * **아무것도 실행하지 않으셔도 됩니다.** 그래서 이 방법을 씁니다.
 *
 * 【값이 갈리면 지어내지 않습니다】
 * 3사가 같아야 정상이지만 실제로는 갈릴 수 있습니다(수집이 틀렸거나
 * 정말 다른 판형이 묶였거나). 가장 많이 나온 값을 씁니다.
 * 동점이면 **비웁니다.** 모르는 것을 아는 척하지 않습니다.
 */
export type BookStoreInfo = {
  /** 책번호 → 정가 */
  prices: Map<number, number>;
  /** 책번호 → 이 책에 묶여 있는 서점 번호들 */
  linked: Map<number, Set<number>>;
};

/**
 * 여러 책의 **정가**와 **묶여 있는 서점**을 한 번에 읽어옵니다.
 *
 * ⚠️ 조회는 하나입니다. 정가만 볼 때와 요청 수가 똑같습니다.
 *    (예전에는 정가가 있는 줄만 골라 읽었는데, 그러면 '정가를 아직 안
 *     걷은 서점' 이 안 묶인 것처럼 보입니다. 그래서 전부 읽고 나눕니다)
 */
export async function storeInfoByBook(
  bookIds: number[]
): Promise<BookStoreInfo> {
  const prices = new Map<number, number>();
  const linked = new Map<number, Set<number>>();
  const ids = [...new Set(bookIds.filter((n) => Number.isFinite(n)))];
  if (!ids.length) return { prices, linked };

  // ⚠️ .in() 목록이 길면 주소가 너무 길어져 요청 자체가 실패합니다.
  //    (2026-08-10 에 겪은 것과 같은 문제라 300개씩 나눕니다)
  const votes = new Map<number, Map<number, number>>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await db()
      .from("store_books")
      .select("book_id, store_id, list_price")
      .in("book_id", ids.slice(i, i + 300));
    if (error || !data) continue; // 곁들이는 값이라 실패해도 화면은 뜹니다
    const rows = data as {
      book_id: number | null;
      store_id: number;
      list_price: number | null;
    }[];
    for (const r of rows) {
      if (!r.book_id) continue;
      let set = linked.get(r.book_id);
      if (!set) linked.set(r.book_id, (set = new Set()));
      set.add(r.store_id);
      if (r.list_price === null) continue;   // 정가는 아직 없을 수 있습니다
      let m = votes.get(r.book_id);
      if (!m) votes.set(r.book_id, (m = new Map()));
      m.set(r.list_price, (m.get(r.list_price) ?? 0) + 1);
    }
  }

  for (const [bookId, m] of votes) {
    const got = bestPrice(m);
    if (got !== null) prices.set(bookId, got);
  }
  return { prices, linked };
}

/**
 * 한 책의 서점별 정가들 중 무엇을 보여줄지 고릅니다.
 * 돌려주는 값: 정가 또는 null(모르겠으면)
 *
 * ⚠️ 동점이면 **비웁니다.** 세 서점이 22,000 / 18,000 처럼 갈렸는데
 *    한쪽을 골라 보여주면, 대표님은 그게 확인된 값인 줄 아십니다.
 *    그건 없는 것보다 나쁩니다.
 */
export function bestPrice(votes: Map<number, number>): number | null {
  let best: number | null = null;
  let bestN = 0;
  let tied = false;
  for (const [price, n] of votes) {
    if (n > bestN) {
      best = price;
      bestN = n;
      tied = false;
    } else if (n === bestN) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/**
 * 그 기간에서 '몇 위까지 볼지' 의 기본값.
 *
 * 【2026-08-11 — 모으는 양과 보는 양을 맞췄습니다】
 * 대표님 결정으로 **일간 300위 · 주간 500위**까지 모읍니다.
 * 그런데 화면은 기간과 상관없이 300위까지만 보고 있었습니다.
 * 주간 301~500위는 **모아 놓고 한 번도 안 쓰는 자료**였습니다.
 * 모으는 기준(config/sources.yaml)과 같은 숫자를 씁니다.
 */
export function defaultDepth(period: Period): number {
  return period === "weekly" ? 500 : 300;
}

/**
 * 목록 한 벌에 **정가**와 **묶인 서점**을 채워 넣습니다 (자리에서 바로).
 *
 * ⚠️ 조회는 한 번입니다. 예전에 정가만 채울 때와 요청 수가 같습니다.
 */
async function fillStoreInfo(
  rows: { bookId: number; listPrice: number | null; linked?: number[] }[]
) {
  if (!rows.length) return;
  const { prices, linked } = await storeInfoByBook(rows.map((r) => r.bookId));
  for (const r of rows) {
    r.listPrice = prices.get(r.bookId) ?? null;
    // ⚠️ 못 읽었으면 **빈 배열이 아니라** 그대로 둡니다.
    //    빈 배열은 "어느 서점에도 안 묶임" 이라는 뜻이 되어 버립니다.
    //    모르는 것을 아는 척하면 안 됩니다.
    const set = linked.get(r.bookId);
    if (set) r.linked = [...set];
  }
}

/** 순위 한 줄에 딸려오는 도서 정보 (rankings → store_books 이어붙이기) */
const STORE_BOOK_JOIN = `store_book:store_books!inner (
    id, store_id, raw_title, raw_author, raw_publisher,
    pub_ym, list_price, sale_price, cover_url, isbn13, book_id
  )`;

const RANKING_COLUMNS = `rank, sales_point, ${STORE_BOOK_JOIN}`;

/** 특정 날짜·분야의 순위표. 어제와 비교해 등락도 함께 계산합니다. */
export async function getRankings(
  categoryId: number,
  date: string,
  limit = 50,
  offset = 0
): Promise<RankingRow[]> {
  const { data, error } = await db()
    .from("rankings")
    .select(RANKING_COLUMNS)
    .eq("category_id", categoryId)
    .eq("snapshot_date", date)
    .order("rank")
    .range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Omit<RankingRow, "change" | "isNew">[];

  // ---- 등락 계산: 바로 이전 수집일과 비교 ----
  //
  // 【화면에 보이는 책만 물어봅니다 — 2026-08-08 속도 개선】
  // 예전에는 어제 순위 1,000줄을 통째로 받아왔습니다. 화면에는 50권만
  // 보이는데 950줄은 버리는 셈이라, 이것만으로도 화면이 몇 초씩 멈췄습니다.
  // 이제 보이는 책의 번호만 넘겨서 딱 그만큼만 받아옵니다.
  const prevDate = await getPreviousDate(categoryId, date);
  const prevRank = new Map<number, number>();
  if (prevDate && rows.length) {
    const { data: prev } = await db()
      .from("rankings")
      .select("rank, store_book_id")
      .eq("category_id", categoryId)
      .eq("snapshot_date", prevDate)
      .in(
        "store_book_id",
        rows.map((r) => r.store_book.id)
      );
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

/** 이 분야에 그날 몇 권이 있는지 (더보기 버튼을 보일지 판단용) */
export async function countRankings(
  categoryId: number,
  date: string
): Promise<number> {
  const { count, error } = await db()
    .from("rankings")
    .select("rank", { count: "exact", head: true })
    .eq("category_id", categoryId)
    .eq("snapshot_date", date);
  if (error) throw error;
  return count ?? 0;
}

/** 이 분야에서 주어진 날짜 '바로 앞' 수집일을 찾습니다. */
export async function getPreviousDate(
  categoryId: number,
  date: string
): Promise<string | null> {
  const { data } = await db()
    .from("rankings")
    .select("snapshot_date")
    .eq("category_id", categoryId)
    .lt("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  return (data?.[0]?.snapshot_date as string) ?? null;
}

/**
 * 이 분야에 실제로 자료가 있는 날짜만.
 *
 * 【왜 만들었나요? — 2026-08-08 대표님 지적】
 * "서점별에서 알라딘·일간·전체·8/8 을 보니까 수집된 데이터가 없다고 하는데,
 *  8월 7일은 있거든?"
 *
 * 원인은 날짜 목록이 세 서점을 통째로 합친 목록이었기 때문입니다. 교보가
 * 8월 8일치를 저장하면 8월 8일이 목록에 뜨고, 알라딘의 그 분야에 8월 8일치가
 * 없어도 고를 수 있었습니다. 고르면 빈 표가 나오는데 이유는 알 수 없었습니다.
 *
 * 이제 서점별 화면은 '고른 분야에 실제로 있는 날짜' 만 보여줍니다.
 * 고를 수 있는 날짜는 전부 자료가 있는 날짜입니다.
 *
 */
export async function getCategoryDates(
  categoryId: number,
  limit = 400
): Promise<string[]> {
  // ---- 빠른 길: 데이터베이스가 날짜만 뽑아 줍니다 (db/perf.sql) ----
  const fast = await db().rpc("category_dates", {
    p_category_id: categoryId,
    n: limit,
  });
  if (!fast.error && fast.data) {
    return (fast.data as { snapshot_date: string }[]).map((r) => r.snapshot_date);
  }

  // ---- 느린 길: perf.sql 을 아직 실행하지 않았을 때 ----
  // 순위표를 1,000줄씩 읽습니다. 한 분야가 하루 200권이면 12번 읽어도
  // 60일치밖에 못 봅니다. 그래서 위의 빠른 길이 켜져 있어야 합니다.
  const seen = new Set<string>();
  const step = 1000;
  for (let page = 0; page < 12 && seen.size < limit; page += 1) {
    const { data, error } = await db()
      .from("rankings")
      .select("snapshot_date")
      .eq("category_id", categoryId)
      .order("snapshot_date", { ascending: false })
      .range(page * step, page * step + step - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) seen.add(r.snapshot_date as string);
    if (rows.length < step) break;
  }
  return [...seen].slice(0, limit);
}

// ---------------------------------------------------------------------------
//  종합 베스트셀러 — 3사 순위의 평균
// ---------------------------------------------------------------------------

export type CombinedRow = {
  bookId: number;
  title: string;
  author: string | null;
  publisher: string | null;
  coverUrl: string | null;
  /** 서점별 순위. 그 서점 목록에 없으면 키가 없습니다 (0 으로 채우지 않음) */
  ranks: Record<number, number>;
  /**
   * 이 책에 **묶여 있는** 서점 번호들.
   *
   * 【2026-08-12 대표님 지적 — 왜 이게 필요한가요?】
   *   "묶이지 않은 서점이 있는 경우에도 그 서점을 '순위 밖' 으로 표시하고,
   *    묶인 경우인데 순위에서 빠진 경우 '순위 밖' 이라고 표시하거든?
   *    그래서 가끔 좀 헷갈리는데"
   *
   * 맞습니다. 뜻이 완전히 다릅니다.
   *   · 묶여 있는데 순위에 없음 → 그 서점에서 **순위 밖** (시장 신호)
   *   · 아예 안 묶여 있음       → 그 서점 상품을 **못 찾음** (자료 한계)
   *
   * 이 값이 있으면 화면이 둘을 구분해서 적을 수 있습니다.
   */
  linked: number[];
  /** 서점별 판매지수. 교보는 제공하지 않아 항상 없습니다 */
  sales: Record<number, number>;
  /** 등장한 서점 수 */
  storeCount: number;
  /** 등장한 서점들의 순위 평균. 없는 서점은 계산에서 뺍니다 */
  avgRank: number;
  /**
   * 정가(원). 아직 안 걷힌 책은 null 입니다.
   *
   * 【왜 한 값만 두나요? — 2026-08-11 대표님 요청】
   * 도서정가제상 정가는 출판사가 정한 하나의 값이라 3사가 같아야 합니다.
   * 그래서 서점별로 나눠 보여줄 이유가 없습니다.
   * 서점마다 값이 갈리면 지어내지 않고 비웁니다 (pricesByBook 참고).
   */
  listPrice: number | null;
};

// ⚠️ 판매지수는 서점끼리 평균 내지 않습니다.
//    예스24 '판매지수' 와 알라딘 '세일즈포인트' 는 계산식이 다른 별개의 값이라
//    더해서 나누면 아무 뜻도 없는 숫자가 나옵니다.
//    그래서 서점별로 따로 보여줍니다. (교보는 아예 제공하지 않습니다)

/**
 * 종합 베스트셀러를 계산합니다.
 *
 * 【계산 방법 — 화면에도 그대로 적어 둡니다】
 * 1. 고른 기간·분야에 해당하는 3사 목록을 각각 가져옵니다.
 * 2. 같은 책으로 묶인 것(book_id)끼리 모읍니다.
 * 3. 한 서점 안에서 여러 분야에 올라 있으면 '가장 높은 순위' 를 그 서점 값으로 씁니다.
 * 4. 등장한 서점들의 순위를 평균 냅니다.
 *
 * 【지어내지 않는 부분】
 * 어떤 서점 목록에 없는 책은 그 서점 칸을 '없음' 으로 둡니다.
 * "1001위" 같은 가짜 숫자를 넣어 평균을 내리지 않습니다.
 * 대신 '몇 개 서점에 올랐는지' 를 같이 보여주고, 기본적으로
 * 2개 이상 서점에 오른 책만 종합 순위에 넣습니다.
 *
 * 【아직 안 묶인 책】
 * book_id 가 없는 책(= 아직 같은 책 묶기가 안 된 책)은 제외합니다.
 * 묶이지 않은 채로 넣으면 같은 책이 3번 따로 등장해 순위가 망가집니다.
 */
export async function getCombinedBest(
  date: string,
  period: Period,
  unifiedCode: string,
  opts: { minStores?: number; depth?: number; limit?: number } = {}
): Promise<{
  rows: CombinedRow[];
  depth: number;
  usedCategories: Category[];
  fast: boolean;
}> {
  const minStores = opts.minStores ?? 2;
  // 각 서점에서 몇 위까지 볼지. 너무 깊게 보면 화면이 느려집니다.
  const depth = opts.depth ?? defaultDepth(period);
  const limit = opts.limit ?? 100;

  const cats = (await getCategories()).filter(
    (c) =>
      c.unified_code === unifiedCode &&
      periodOf(c) === period &&
      c.kind !== "offline" // 매장별은 온라인 순위와 성격이 달라 섞지 않습니다
  );
  if (!cats.length) {
    return { rows: [], depth, usedCategories: [], fast: true };
  }

  // ---- 빠른 길: 데이터베이스가 계산해서 100줄만 보내줍니다 (db/perf.sql) ----
  // 예전에는 순위 6,000줄을 받아와 사이트에서 직접 계산했습니다.
  const rpc = await db().rpc("combined_best", {
    p_date: date,
    p_period: period,
    p_unified: unifiedCode,
    p_min_stores: minStores,
    p_depth: depth,
    p_limit: limit,
  });
  if (!rpc.error && rpc.data) {
    const rows = (rpc.data as RpcCombinedRow[]).map((r) => ({
      bookId: Number(r.book_id),
      title: r.title,
      author: r.author,
      publisher: r.publisher,
      coverUrl: r.cover_url,
      ranks: numberMap(r.ranks),
      sales: numberMap(r.sales),
      storeCount: r.store_count,
      avgRank: Number(r.avg_rank),
      listPrice: null as number | null,
      linked: [] as number[],
    }));
    await fillStoreInfo(rows);
    return {
      rows,
      depth,
      usedCategories: await usedIn(cats, date),
      fast: true,
    };
  }

  // ---- 느린 길: db/perf.sql 을 아직 실행하지 않았을 때 ----
  const rankRows = await selectAll<{
    rank: number;
    sales_point: number | null;
    category_id: number;
    store_book: StoreBook;
  }>(
    (from, to) =>
      db()
        .from("rankings")
        // ⚠️ RANKING_COLUMNS 를 그대로 붙이면 rank·sales_point 가 두 번 들어갑니다.
        //    필요한 열만 명시적으로 적습니다.
        .select(`rank, sales_point, category_id, ${STORE_BOOK_JOIN}`)
        .in(
          "category_id",
          cats.map((c) => c.id)
        )
        .eq("snapshot_date", date)
        .lte("rank", depth)
        .order("rank")
        .range(from, to),
    6000
  );

  const catStore = new Map(cats.map((c) => [c.id, c.store_id]));
  // 정가는 맨 마지막에 한 번에 채우므로(fillPrices) 모으는 동안에는 없습니다
  type Acc = Omit<
    CombinedRow,
    "storeCount" | "avgRank" | "avgSales" | "listPrice"
  >;
  const acc = new Map<number, Acc>();

  for (const r of rankRows) {
    const bookId = r.store_book?.book_id;
    if (!bookId) continue; // 아직 안 묶인 책은 제외 (같은 책이 3번 세어지는 것 방지)
    const storeId = catStore.get(r.category_id) ?? r.store_book.store_id;

    let cur = acc.get(bookId);
    if (!cur) {
      cur = {
        bookId,
        title: r.store_book.raw_title,
        author: r.store_book.raw_author,
        publisher: r.store_book.raw_publisher,
        coverUrl: r.store_book.cover_url,
        ranks: {},
        sales: {},
        linked: [],       // 아래 fillStoreInfo 가 채웁니다
      };
      acc.set(bookId, cur);
    }
    // 같은 서점에서 더 높은(작은) 순위를 만나면 그걸로 바꿉니다
    if (cur.ranks[storeId] === undefined || r.rank < cur.ranks[storeId]) {
      cur.ranks[storeId] = r.rank;
      if (r.sales_point != null) cur.sales[storeId] = r.sales_point;
    }
    // 표지는 알라딘(3) → 예스24(2) → 교보(1) 순으로 더 나은 것이 있으면 교체
    if (!cur.coverUrl && r.store_book.cover_url) cur.coverUrl = r.store_book.cover_url;
  }

  const rows: CombinedRow[] = [];
  for (const a of acc.values()) {
    const rankList = Object.values(a.ranks);
    if (rankList.length < minStores) continue;
    rows.push({
      ...a,
      storeCount: rankList.length,
      avgRank: rankList.reduce((x, y) => x + y, 0) / rankList.length,
      listPrice: null,
      linked: [],
    });
  }

  rows.sort((x, y) => x.avgRank - y.avgRank || y.storeCount - x.storeCount);
  const top = rows.slice(0, limit);
  await fillStoreInfo(top);
  return { rows: top, depth, usedCategories: await usedIn(cats, date), fast: false };
}

/** 데이터베이스 함수가 돌려주는 모양 (db/perf.sql 의 combined_best) */
type RpcCombinedRow = {
  book_id: number | string;
  title: string;
  author: string | null;
  publisher: string | null;
  cover_url: string | null;
  store_count: number;
  avg_rank: number | string;
  ranks: Record<string, number> | null;
  sales: Record<string, number> | null;
};

/** {"3": 12} 처럼 문자열 열쇠로 온 것을 숫자 열쇠로 바꿉니다 */
function numberMap(src: Record<string, number> | null): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(src ?? {})) out[Number(k)] = Number(v);
  return out;
}

/**
 * '이 분야로 쓴 목록' 에서 그날 실제로 자료가 있는 분야만 남깁니다.
 *
 * 【왜 필요한가요? — 2026-08-08 대표님 지적】
 * 일간을 눌렀는데 "알라딘 전체 · 알라딘 종합" 처럼 한 서점이 두 번 나왔습니다.
 * 예전 설정에 있던 알라딘 '전체'(코드 없음)를 새 설정에서 '종합'(코드 0)으로
 * 바꿨는데, 데이터베이스의 옛 줄이 켜진 채로 남아 있었기 때문입니다.
 * 그 옛 분야에는 오늘 자료가 없어서 순위 숫자에는 영향이 없었지만,
 * 목록에 이름이 뜨니 "왜 둘을 같이 넣었나" 로 보일 수밖에 없습니다.
 *
 * 수집 쪽에서 옛 분야를 자동으로 끄도록 고쳤고(db.disable_missing_categories),
 * 화면에서도 '그날 자료가 실제로 있는 분야' 만 보여줍니다. 두 겹으로 막습니다.
 *
 * 분야가 보통 2~4개뿐이라 확인 비용은 무시할 수준입니다.
 */
async function usedIn(cats: Category[], date: string): Promise<Category[]> {
  const checks = await Promise.all(
    cats.map(async (c) => {
      const { count } = await db()
        .from("rankings")
        .select("rank", { count: "exact", head: true })
        .eq("category_id", c.id)
        .eq("snapshot_date", date);
      return (count ?? 0) > 0 ? c : null;
    })
  );
  return checks.filter((c): c is Category => c !== null);
}

/** 종합 순위에서 고를 수 있는 통합 분야 목록 (3사에 모두 있는 것 우선) */
export function unifiedOptions(
  cats: Category[],
  period: Period
): { code: string; label: string; storeCount: number }[] {
  const map = new Map<string, { names: string[]; stores: Set<number> }>();
  for (const c of cats) {
    if (!c.unified_code || c.kind === "offline") continue;
    if (periodOf(c) !== period) continue;
    const e = map.get(c.unified_code) ?? { names: [], stores: new Set<number>() };
    e.names.push(c.name);
    e.stores.add(c.store_id);
    map.set(c.unified_code, e);
  }
  return [...map.entries()]
    .filter(([, e]) => e.stores.size >= 2) // 최소 2개 서점에 있어야 비교가 됩니다
    .map(([code, e]) => ({
      code,
      // 가장 짧은 이름을 대표로 씁니다 ('경제 경영' vs '경제/경영' → 짧은 쪽)
      label: e.names.sort((a, b) => a.length - b.length)[0],
      storeCount: e.stores.size,
    }))
    .sort(
      (a, b) =>
        // 종합(전체)은 무조건 맨 앞. 가장 많이 보는 분야입니다.
        (a.code === "all" ? 0 : 1) - (b.code === "all" ? 0 : 1) ||
        b.storeCount - a.storeCount ||
        a.label.localeCompare(b.label, "ko")
    );
}

// ---------------------------------------------------------------------------
//  검색 / 도서 상세
// ---------------------------------------------------------------------------

/** 제목·저자·출판사로 찾기 */
export async function searchBooks(q: string, limit = 60) {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term}%`;
  const { data, error } = await db()
    .from("store_books")
    .select(
      "id,store_id,raw_title,raw_author,raw_publisher,pub_ym,list_price,sale_price,cover_url,isbn13,book_id"
    )
    .or(
      `raw_title.ilike.${like},raw_author.ilike.${like},raw_publisher.ilike.${like}`
    )
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type HistoryPoint = {
  date: string;
  storeId: number;
  period: Period;
  rank: number;
  sales: number | null;
  /** 이 순위가 나온 분야 */
  categoryName: string;
  /**
   * 통합 분야 코드 ('fiction', 'business' …). 서점이 달라도 같은 분야면
   * 같은 값이라, 이걸로 3사를 나란히 비교할 수 있습니다.
   * 'all' 이면 종합(전체)입니다.
   */
  unifiedCode: string;
  /** 그 분야가 '종합(전체)' 인지 */
  isOverall: boolean;
};

/** 이 책이 올랐던 분야 하나 (고르는 버튼을 만들 때 씁니다) */
export type CategoryChoice = {
  unifiedCode: string;
  name: string;
  /** 며칠이나 올라 있었나 (많은 것부터 보여주려고) */
  days: number;
  /** 그 분야에서의 최고 순위 */
  bestRank: number;
};

export type CurrentPlacement = {
  storeId: number;
  period: Period;
  categoryName: string;
  branchName: string;
  rank: number;
  sales: number | null;
  /** 통합 분야 코드. 'all' 이면 분야가 아니라 '전체(종합)' 목록입니다 */
  unifiedCode: string | null;
  /** 전체(종합) 순위인가, 특정 분야 안에서의 순위인가 */
  isOverall: boolean;
};

/**
 * 한 권에 대해 화면에 필요한 모든 것.
 *
 * - stores    : 서점별 표기(제목·저자가 서점마다 조금씩 다릅니다)
 * - history   : 날짜별 추이. 그래프용. 일간/주간을 나눠서 담습니다.
 * - placements: 오늘 이 책이 올라 있는 모든 분야 (일간·주간·매장 포함)
 */
export async function getBookDetail(bookId: number): Promise<{
  stores: StoreBook[];
  history: HistoryPoint[];
  categoryChoices: CategoryChoice[];
  placements: CurrentPlacement[];
  latestDate: string | null;
}> {
  const { data: sbs, error } = await db()
    .from("store_books")
    .select(
      "id,store_id,raw_title,raw_author,raw_publisher,pub_ym,list_price,sale_price,cover_url,isbn13,book_id"
    )
    .eq("book_id", bookId);
  if (error) throw error;

  const stores = (sbs ?? []) as StoreBook[];
  const ids = stores.map((s) => s.id);
  if (!ids.length) {
    return { stores: [], history: [], categoryChoices: [], placements: [], latestDate: null };
  }

  const [cats, raw] = await Promise.all([
    getCategories(),
    selectAll<{
      snapshot_date: string;
      rank: number;
      sales_point: number | null;
      store_book_id: number;
      category_id: number;
    }>(
      (from, to) =>
        db()
          .from("rankings")
          .select("snapshot_date,rank,sales_point,store_book_id,category_id")
          .in("store_book_id", ids)
          .order("snapshot_date", { ascending: true })
          .range(from, to),
      12000
    ),
  ]);

  const catById = new Map(cats.map((c) => [c.id, c]));
  const storeOf = new Map(stores.map((s) => [s.id, s.store_id]));

  // ---- 추이: (날짜, 서점, 기간) 마다 '가장 높은 순위' 하나만 씁니다 ----
  // 한 책이 하루에 '전체'·'소설'·'한국소설' 세 곳에 오를 수 있는데,
  // 그래프에 세 줄을 겹쳐 그리면 읽을 수 없습니다.
  const best = new Map<string, HistoryPoint>();
  const placements: CurrentPlacement[] = [];
  let latestDate: string | null = null;

  for (const r of raw) {
    const cat = catById.get(r.category_id);
    const storeId = storeOf.get(r.store_book_id);
    if (!cat || storeId === undefined) continue;
    if (!latestDate || r.snapshot_date > latestDate) latestDate = r.snapshot_date;

    // 매장별은 추이 그래프에 넣지 않습니다 (온라인 순위와 성격이 다릅니다)
    if (cat.kind === "offline") continue;

    const period = periodOf(cat);
    const isOverall = cat.unified_code === "all";

    /*
      【2026-08-10 대표님 지적 — 이게 진짜 문제였습니다】
      "분야에서 순위권에 있다가 종합 순위에 오르기 시작하면 어떡하려고
       그래? 이걸 선택할 수 있도록 해주면 좋지 않을까?"

      맞습니다. 예전에는 하루에 한 점만 남기면서 **종합이 있으면 종합,
      없으면 분야** 를 골랐습니다. 그러면 어제까지 '소설 3위' 로 그리다가
      오늘 종합에 처음 들면 '종합 150위' 로 바뀝니다.
      그래프는 3위 → 150위 로 **폭락한 것처럼** 보입니다.
      실제로는 더 잘 팔려서 종합에 든 것인데 정반대로 읽힙니다.

      한 줄에 두 가지 기준을 섞으면 그 줄은 아무 뜻도 없습니다.
      그래서 이제 **두 기준을 따로 담습니다.** 어느 쪽을 볼지는 화면에서
      대표님이 고르십니다 (app/book/[id]/page.tsx).
    */
    /*
      【2026-08-10 대표님 추가 지적】
      "분야도 한번에 여러 분야 카테고리에 오르는 경우가 있잖아.
       이런 경우는 어떡해?"

      같은 문제가 한 단계 아래에서 그대로 반복되고 있었습니다.
      '소설 5위' 와 '한국소설 2위' 에 동시에 올라 있으면 예전에는 2위만
      남겼는데, 다음 날 한국소설에서 빠지면 갑자기 '소설 6위' 가 됩니다.
      2위 → 6위 로 떨어진 것처럼 보이지만 소설 순위는 5위 → 6위,
      한 계단 움직였을 뿐입니다.

      그래서 **분야마다 따로 담습니다.** 무엇을 볼지는 화면에서 고릅니다.
      (같은 분야 안에서 여러 줄이 오는 경우만 가장 높은 것을 남깁니다)
    */
    const uni = cat.unified_code ?? `x_${cat.id}`;
    const key = `${r.snapshot_date}|${storeId}|${period}|${uni}`;
    const cur = best.get(key);
    const better = !cur || r.rank < cur.rank;

    if (better) {
      best.set(key, {
        date: r.snapshot_date,
        storeId,
        period,
        rank: r.rank,
        sales: r.sales_point,
        categoryName: cat.name,
        unifiedCode: uni,
        isOverall,
      });
    }
  }

  // ---- 오늘 올라 있는 분야 목록 ----
  for (const r of raw) {
    if (r.snapshot_date !== latestDate) continue;
    const cat = catById.get(r.category_id);
    const storeId = storeOf.get(r.store_book_id);
    if (!cat || storeId === undefined) continue;
    placements.push({
      storeId,
      period: periodOf(cat),
      categoryName: cat.name,
      branchName: cat.branch_name,
      rank: r.rank,
      sales: r.sales_point,
      unifiedCode: cat.unified_code,
      // 'all' = 그 서점의 '전체/종합' 목록. 분야 순위와 뜻이 완전히 다릅니다.
      isOverall: cat.unified_code === "all",
    });
  }
  // 서점 → 전체(종합)를 맨 위로 → 일간 먼저 → 순위 순
  // (예전에는 서점·순위로만 정렬해서 전체 순위와 분야 순위가 뒤섞였습니다)
  placements.sort(
    (a, b) =>
      a.storeId - b.storeId ||
      Number(b.isOverall) - Number(a.isOverall) ||
      (a.period === b.period ? 0 : a.period === "daily" ? -1 : 1) ||
      a.rank - b.rank
  );

  const history = [...best.values()].sort((a, b) => a.date.localeCompare(b.date));

  /*
    이 책이 올랐던 **분야 목록** — 화면에서 고르는 버튼을 만드는 재료입니다.
    같은 분야는 서점이 달라도 하나로 묶습니다(통합 분야 코드).
    오래 머문 분야를 앞에 둡니다. 하루 반짝 오른 분야가 맨 앞에 있으면
    누를 것을 찾기 어렵습니다.
  */
  const catMap = new Map<string, CategoryChoice & { seen: Set<string> }>();
  for (const h of history) {
    if (h.isOverall) continue;
    const cur = catMap.get(h.unifiedCode);
    if (!cur) {
      catMap.set(h.unifiedCode, {
        unifiedCode: h.unifiedCode,
        name: h.categoryName,
        days: 0,
        bestRank: h.rank,
        seen: new Set(),
      });
    }
    const it = catMap.get(h.unifiedCode)!;
    it.seen.add(h.date);
    it.days = it.seen.size;
    if (h.rank < it.bestRank) it.bestRank = h.rank;
  }
  const categoryChoices: CategoryChoice[] = [...catMap.values()]
    .map(({ seen: _seen, ...rest }) => rest)
    .sort((a, b) => b.days - a.days || a.bestRank - b.bestRank);

  return { stores, history, placements, latestDate, categoryChoices };
}

/** 최근 수집이 잘 됐는지 (화면 상단에 정직하게 표시하기 위함) */
export async function getRecentCrawlStatus(limit = 12) {
  const { data } = await db()
    .from("crawl_logs")
    .select("snapshot_date,store_id,status,items_collected,error_message")
    .order("id", { ascending: false })
    .limit(limit);
  return data ?? [];
}

/**
 * 보관소로 옮겨진 날짜 범위.
 *
 * 【왜 필요한가요?】
 * 오래된 순위 기록은 Supabase 용량 때문에 Cloudflare R2 로 옮깁니다.
 * 그러면 사이트 날짜 목록에서 사라지는데, 그냥 사라지면
 * "수집이 안 된 날" 과 구분이 안 됩니다.
 * 그래서 "이 기간은 보관소에 있습니다" 라고 정직하게 표시합니다.
 */
export async function getArchivedRange(): Promise<{
  from: string;
  to: string;
  days: number;
  rows: number;
  /** GitHub 보관일 때, 가장 먼저 사라지는 날 */
  expiresAt: string | null;
  /** 그때까지 남은 날 수 */
  daysLeft: number | null;
  /** 그 파일을 내려받을 수 있는 주소 */
  runUrl: string | null;
  /** 사라짐이 있는 보관 방식인지 (github) */
  expiring: boolean;
} | null> {
  const { data, error } = await db()
    .from("archives")
    .select("snapshot_date,row_count,storage,expires_at,run_url,saved_at")
    .eq("table_name", "rankings")
    .eq("deleted_from_db", true)
    .order("snapshot_date");

  // archives 표가 아직 없으면(설정 전) 조용히 넘어갑니다
  if (error || !data?.length) return null;

  type Row = {
    snapshot_date: string;
    row_count: number | null;
    storage?: string | null;
    expires_at?: string | null;
    run_url?: string | null;
    saved_at?: string | null;
  };
  const rows = data as unknown as Row[];
  const dates = rows.map((r) => r.snapshot_date);

  /**
   * 【2026-08-08 GitHub 보관을 쓰기로 함】
   * R2 는 올려두면 영구 보관이지만, GitHub 은 기한이 지나면 파일이
   * 사라집니다. 가장 먼저 사라지는 것을 찾아 화면에 띄웁니다.
   * 이게 안 보이면 대표님이 모르는 사이에 자료가 없어집니다.
   *
   * saved_at 이 채워진 것은 이미 PC 로 받아 두신 것이라 알리지 않습니다.
   * (안 그러면 다 받아 두신 뒤에도 빨간 경고가 계속 떠서,
   *  나중에 진짜 경고까지 무시하게 됩니다)
   */
  const withExpiry = rows.filter((r) => r.expires_at && !r.saved_at);
  withExpiry.sort((a, b) => (a.expires_at! < b.expires_at! ? -1 : 1));
  const first = withExpiry[0] ?? null;

  let daysLeft: number | null = null;
  if (first?.expires_at) {
    const ms = new Date(`${first.expires_at}T00:00:00+09:00`).getTime() - Date.now();
    daysLeft = Math.max(0, Math.ceil(ms / 86_400_000));
  }

  return {
    from: dates[0],
    to: dates[dates.length - 1],
    days: new Set(dates).size,
    rows: rows.reduce((a, r) => a + (r.row_count ?? 0), 0),
    expiresAt: first?.expires_at ?? null,
    daysLeft,
    runUrl: first?.run_url ?? null,
    expiring: rows.some((r) => r.storage === "github"),
  };
}

// ---------------------------------------------------------------------------
//  출판사 / 저자 순위 · 분야 점유율
//  (전부 db/perf.sql 의 데이터베이스 기능을 씁니다. 없으면 빈 값을 돌려주고
//   화면에 "속도 개선을 켜세요" 안내가 뜹니다 — 조용히 틀린 값을 만들지 않습니다)
// ---------------------------------------------------------------------------

export type NameRank = {
  name: string;
  books: number;
  bestRank: number;
  score: number;
  topTitles: string[];
};

/** 'publisher' = 출판사별, 'author' = 저자별 */
export type NameKind = "publisher" | "author";

export const NAME_KIND_LABEL: Record<NameKind, string> = {
  publisher: "출판사",
  author: "저자",
};

export async function getNameRanking(
  kind: NameKind,
  date: string,
  period: Period,
  unified = "all",
  opts: { depth?: number; minStores?: number; limit?: number } = {}
): Promise<{ rows: NameRank[]; ok: boolean; depth: number }> {
  const depth = opts.depth ?? defaultDepth(period);
  const { data, error } = await db().rpc(
    kind === "publisher" ? "publisher_ranking" : "author_ranking",
    {
      p_date: date,
      p_period: period,
      p_unified: unified,
      p_depth: depth,
      p_min_stores: opts.minStores ?? 1,
      p_limit: opts.limit ?? 50,
    }
  );
  if (error || !data) return { rows: [], ok: false, depth };
  const rows = (data as RpcNameRow[]).map((r) => ({
    name: r.name,
    books: r.books,
    bestRank: Number(r.best_rank),
    score: Number(r.score),
    topTitles: r.top_titles ?? [],
  }));
  return { rows, ok: true, depth };
}

type RpcNameRow = {
  name: string;
  books: number;
  best_rank: number | string;
  score: number | string;
  top_titles: string[] | null;
};

/** 한 출판사(또는 저자)가 순위에 올린 책 목록 */
export async function getBooksOf(
  kind: NameKind,
  name: string,
  date: string,
  period: Period,
  unified = "all",
  opts: { depth?: number; limit?: number } = {}
): Promise<{ rows: CombinedRow[]; ok: boolean }> {
  const { data, error } = await db().rpc("books_of", {
    p_field: kind,
    p_name: name,
    p_date: date,
    p_period: period,
    p_unified: unified,
    p_depth: opts.depth ?? defaultDepth(period),
    p_limit: opts.limit ?? 100,
  });
  if (error || !data) return { rows: [], ok: false };
  const rows = (data as RpcCombinedRow[]).map((r) => ({
    bookId: Number(r.book_id),
    title: r.title,
    author: r.author,
    publisher: r.publisher,
    coverUrl: r.cover_url,
    ranks: numberMap(r.ranks),
    sales: numberMap(r.sales),
    storeCount: r.store_count,
    avgRank: Number(r.avg_rank),
    listPrice: null as number | null,
    linked: [] as number[],
  }));
  await fillStoreInfo(rows);
  return { rows, ok: true };
}

export type CategoryShare = { code: string; label: string; books: number };

/**
 * 종합 상위권을 어떤 분야가 채우고 있는지.
 *
 * ⚠️ 한 권이 여러 분야에 들 수 있어(소설이면서 한국소설) 합이 100%가 아닙니다.
 *    비율이 아니라 '몇 권이 걸쳐 있나' 로 읽어야 합니다. 화면에도 그렇게 씁니다.
 */
export async function getCategoryShare(
  date: string,
  period: Period,
  top = 100
): Promise<{ rows: CategoryShare[]; ok: boolean; top: number }> {
  const { data, error } = await db().rpc("category_share", {
    p_date: date,
    p_period: period,
    p_top: top,
  });
  if (error || !data) return { rows: [], ok: false, top };
  return {
    rows: (data as { unified_code: string; label: string; books: number }[]).map(
      (r) => ({ code: r.unified_code, label: r.label, books: r.books })
    ),
    ok: true,
    top,
  };
}
