/**
 * 매칭 검토 — "이 둘이 같은 책인가" 를 사람이 판단하는 화면의 자료.
 *
 * 【왜 필요한가요?】
 * 같은 책 묶기는 애매한 경우를 '검토 필요(auto_low)' 로 표시만 하고
 * 넘어갑니다. 코드에는 "사람이 내린 결정이 최우선" 이라고 되어 있는데,
 * 정작 사람이 결정할 화면이 없었습니다.
 * **잘못 묶인 책을 발견해도 고칠 방법이 없는 상태였습니다.**
 */

import { db } from "./supabase";

/** 검토 화면의 탭 */
export type ReviewTab = "pending" | "merged" | "mine";

export const TAB_LABEL: Record<ReviewTab, string> = {
  pending: "검토 대기",
  merged: "자동으로 묶은 것",
  mine: "내가 내린 결정",
};

export const TAB_HELP: Record<ReviewTab, string> = {
  pending:
    "점수가 애매해서 일단 묶어 두었지만 확신이 없는 짝입니다. " +
    "여기 있는 것부터 보시면 됩니다.",
  merged:
    "점수가 높아 자동으로 묶은 짝입니다. 잘못 묶인 것을 발견하시면 " +
    "여기서 [다른 책] 을 눌러 떼어낼 수 있습니다.",
  mine: "대표님이 직접 누르신 결정입니다. 되돌릴 수 있습니다.",
};

/** 탭 → 데이터베이스에 저장된 값 */
const TAB_DECISIONS: Record<ReviewTab, string[]> = {
  pending: ["auto_low"],
  merged: ["auto_high"],
  mine: ["manual_merge", "manual_split"],
};

export function isReviewTab(v: string | undefined): v is ReviewTab {
  return v === "pending" || v === "merged" || v === "mine";
}

/* ═══════════════════════════════════════════════ 묶음 크기 (몇 권이 묶였나) */

/**
 * 【2026-08-09 대표님 요청】
 * "매칭 내역에 3개만 묶인 경우, 4개 이상을 묶어둔 경우와 2개 이하만
 *  묶어둔 경우도 찾아서 고를 수 있었으면 좋겠어."
 *
 * 서점이 셋이므로 **3권이 정상**입니다. 거기서 벗어난 것이 볼 거리입니다.
 *
 *   2권 이하 → 한 서점을 놓쳤을 수 있음 (있는데 못 묶은 경우)
 *   3권      → 정상 (세 서점에서 한 권씩)
 *   4권 이상 → 🚨 한 서점에서 두 권이 묶였다는 뜻입니다.
 *              개정판·세트·다른 판형이 섞였을 가능성이 큽니다.
 */
export type SizeGroup = "small" | "exact" | "large";

export const SIZE_LABEL: Record<SizeGroup, string> = {
  small: "2권 이하",
  exact: "3권 (정상)",
  large: "4권 이상",
};

export const SIZE_HELP: Record<SizeGroup, string> = {
  small: "한 서점을 놓쳤을 수 있습니다. 있는데 못 묶은 경우입니다.",
  exact: "서점이 셋이므로 이것이 정상입니다.",
  large: "한 서점에서 두 권이 묶였다는 뜻입니다. 개정판·세트가 섞였을 수 있습니다.",
};

export function sizeGroupOf(n: number): SizeGroup {
  if (n >= 4) return "large";
  if (n === 3) return "exact";
  return "small";
}

export function parseSize(v: string | undefined): SizeGroup | null {
  return v === "small" || v === "exact" || v === "large" ? v : null;
}

/* ══════════════════════════════════════════════════ 점수 구간 (5점 단위) */

/**
 * 【왜 5점 단위인가요? — 2026-08-09 대표님 요청】
 * "5점 단위? 1점 단위? 뭐든 구분하는 버튼이나 필터를 만들어줬으면"
 *
 * 점수는 0~100점입니다. 그런데 화면에 실제로 나오는 범위는 좁습니다.
 *   · 검토 대기      65~84점  (85점부터는 자동으로 묶여서 여기 없음)
 *   · 자동으로 묶은 것 85~100점
 *
 * 1점 단위로 하면 '검토 대기' 만 버튼이 20개가 됩니다. 휴대폰에서는
 * 버튼을 찾는 게 일이 됩니다. 5점 단위면 각 4~5개로 딱 떨어집니다.
 *
 * ⚠️ 여기 숫자를 config/matching.yaml 의 기준점(auto_high 85 · auto_low 65)과
 *    **똑같이 적어 두지 않았습니다.** 그 설정은 나중에 바뀔 수 있고, 화면이
 *    옛 숫자를 붙들고 있으면 있지도 않은 구간 버튼이 남습니다.
 *    대신 **실제로 몇 건 있는지 세어 보고, 0건인 구간은 아예 안 보여줍니다.**
 *    설정을 바꾸시면 버튼도 저절로 따라 바뀝니다.
 */
export const BAND_STEP = 5;

/** 60점부터 5점씩. 마지막 칸(95)만 100점을 포함합니다. */
export const BAND_STARTS = [60, 65, 70, 75, 80, 85, 90, 95] as const;

export type ScoreBand = { start: number; end: number; label: string };

export function bandRange(start: number): { lo: number; hiExclusive: number } {
  // 마지막 칸은 100점(ISBN 이 같아 확정된 짝)까지 담아야 합니다.
  const last = start === BAND_STARTS[BAND_STARTS.length - 1];
  return { lo: start, hiExclusive: last ? 101 : start + BAND_STEP };
}

export function bandLabel(start: number): string {
  const { hiExclusive } = bandRange(start);
  return `${start}~${hiExclusive - 1}점`;
}

/** 주소에 적힌 band 값이 우리가 아는 구간인지 */
export function parseBand(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return (BAND_STARTS as readonly number[]).includes(n) ? n : null;
}

/**
 * 이 탭에서 구간마다 몇 건인지.
 *
 * ⚠️ 0건인 구간은 돌려주지 않습니다. 화면에 '0' 짜리 버튼이 줄줄이
 *    있으면 누를 것과 못 누를 것이 섞여서 오히려 느려집니다.
 */
export async function getScoreBands(
  tab: ReviewTab
): Promise<{ bands: (ScoreBand & { count: number })[]; ok: boolean }> {
  const supabase = db();
  const decisions = TAB_DECISIONS[tab];

  try {
    const counted = await Promise.all(
      BAND_STARTS.map(async (start) => {
        const { lo, hiExclusive } = bandRange(start);
        const { count, error } = await supabase
          .from("book_matches")
          .select("id", { count: "exact", head: true })
          .in("decision", decisions)
          .gte("score", lo)
          .lt("score", hiExclusive);
        if (error) throw new Error(error.message);
        return {
          start,
          end: hiExclusive - 1,
          label: bandLabel(start),
          count: count ?? 0,
        };
      })
    );
    return { bands: counted.filter((b) => b.count > 0), ok: true };
  } catch {
    // 구간을 못 세었다고 검토 화면 전체가 막히면 안 됩니다.
    // 필터만 감추고 목록은 그대로 보여줍니다.
    return { bands: [], ok: false };
  }
}

export type ReviewBook = {
  id: number;
  storeId: number;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYm: string | null;
  /** 정가 — 3사가 같아야 정상입니다. 다르면 다른 판형입니다 */
  listPrice: number | null;
  isbn13: string | null;
  coverUrl: string | null;
  bookId: number | null;
};

export type ReviewPair = {
  id: number;
  score: number;
  reasons: Record<string, unknown>;
  decision: string;
  autoDecision: string | null;
  decidedAt: string | null;
  a: ReviewBook;
  b: ReviewBook;
  /** 이 짝이 속한 책에 지금 몇 권이 묶여 있는지 (모르면 null) */
  groupSize: number | null;
  /**
   * 🚨 **지금 정말로 한 책으로 묶여 있는가.**
   *
   * 【2026-08-18 대표님 신고】
   *   "실제로는 안 묶여있는데, 왜 매칭도서 페이지에는 자동으로 묶은
   *    것으로 나오지?"
   *
   * 이 화면은 book_matches 에 적힌 판정('auto_high')을 읽습니다. 그런데
   * 그 판정과 **실제로 묶였는지**는 다른 값입니다. 실제는 store_books 의
   * book_id 가 같은지로만 알 수 있습니다.
   *
   * 원인은 매칭 쪽에서 고쳤지만(옛 기록 지우기 + 갈라진 짝 제외), 여기서
   * 한 번 더 봅니다. **판정을 그대로 믿으면 또 조용히 거짓말을 합니다.**
   */
  linked: boolean;
};

const PAGE_SIZE = 20;

/**
 * 묶음 크기를 세려면 store_books 를 통째로 봐야 합니다.
 * 이 숫자보다 많으면 세는 것을 포기하고 **모른다고 말합니다.**
 * (조용히 틀린 숫자를 보여주는 것보다 낫습니다)
 */
const SIZE_SCAN_CAP = 300000;

/** 묶음 크기 필터를 켰을 때 훑어볼 짝의 최대 개수 */
const FILTER_SCAN_CAP = 6000;

/**
 * 책마다 몇 권이 묶여 있는지.
 * 돌려주는 값: { byStoreBook: 서점도서id → 묶음 크기, ok }
 *
 * ⚠️ PostgREST 에는 GROUP BY 가 없어서 직접 세야 합니다.
 *    id 와 book_id 두 칸만 읽으므로 가볍습니다.
 */
async function groupSizes(): Promise<{
  byStoreBook: Map<number, number>;
  ok: boolean;
}> {
  const supabase = db();
  const rows: { id: number; book_id: number | null }[] = [];
  const step = 1000;

  try {
    // 몇 줄인지 **먼저 세고**, 그만큼을 한꺼번에(동시에) 읽습니다.
    //
    // ⚠️ 예전에는 1,000줄씩 앞에서부터 차례로 읽었습니다. 4만 줄이면
    //    40번을 줄 서서 기다립니다. 한 번에 0.2초씩만 걸려도 8초입니다.
    //    그 8초가 내려받기가 멈춘 것처럼 보이던 원인 중 하나였습니다.
    const { count, error: ce } = await supabase
      .from("store_books")
      .select("id", { count: "exact", head: true })
      .not("book_id", "is", null);
    if (ce) throw new Error(ce.message);

    // 🚨 다 못 읽을 것 같으면 **일부만 세지 않습니다.**
    //    일부만 세면 3권 묶인 책이 '2권' 으로 나옵니다. 빈칸보다 나쁩니다.
    //    (틀린 숫자는 아무도 못 알아챕니다)
    if ((count ?? 0) > SIZE_SCAN_CAP) {
      return { byStoreBook: new Map(), ok: false };
    }

    const total = Math.min(count ?? 0, SIZE_SCAN_CAP);
    const starts: number[] = [];
    for (let s = 0; s < total; s += step) starts.push(s);

    // 한 번에 너무 많이 부르면 데이터베이스가 거절합니다. 6개씩 나눠 부릅니다.
    const LANES = 6;
    for (let i = 0; i < starts.length; i += LANES) {
      const batch = await Promise.all(
        starts.slice(i, i + LANES).map(async (s) => {
          const { data, error } = await supabase
            .from("store_books")
            .select("id,book_id")
            .not("book_id", "is", null)
            .order("id")
            .range(s, s + step - 1);
          if (error) throw new Error(error.message);
          return (data ?? []) as { id: number; book_id: number | null }[];
        })
      );
      for (const got of batch) rows.push(...got);
    }
  } catch {
    return { byStoreBook: new Map(), ok: false };
  }

  const perBook = new Map<number, number>();
  for (const r of rows) {
    if (r.book_id == null) continue;
    perBook.set(r.book_id, (perBook.get(r.book_id) ?? 0) + 1);
  }
  const byStoreBook = new Map<number, number>();
  for (const r of rows) {
    if (r.book_id == null) continue;
    byStoreBook.set(r.id, perBook.get(r.book_id) ?? 0);
  }
  return { byStoreBook, ok: true };
}

/* ═══════════════════════════════════════════════════ 제목으로 찾기 */

/**
 * 【2026-08-11 대표님 요청】 "매칭 검토에도 검색 기능을 넣어주면 안될까?"
 *
 * 검토할 짝이 3만 건이 넘습니다. 특정 책이 잘못 묶였다는 걸 아셨을 때
 * 쪽수를 넘겨가며 찾는 건 사실상 불가능합니다.
 *
 * 【왜 두 단계로 찾나요?】
 * 짝(book_matches)에는 제목이 없습니다. 번호만 들어 있습니다.
 * 제목은 다른 표(store_books)에 있어서, 먼저 제목으로 책 번호를 찾고
 * 그 번호로 짝을 찾습니다.
 */
const SEARCH_BOOK_CAP = 400;

async function bookIdsMatching(q: string): Promise<{
  ids: number[];
  capped: boolean;
}> {
  const like = `%${q.trim()}%`;
  const { data, error } = await db()
    .from("store_books")
    .select("id")
    .or(
      `raw_title.ilike.${like},raw_author.ilike.${like},raw_publisher.ilike.${like}`
    )
    .limit(SEARCH_BOOK_CAP + 1);
  if (error) throw new Error(error.message);

  const all = (data ?? []).map((r) => r.id as number);
  // ⚠️ 너무 많으면 앞쪽만 씁니다. 조용히 자르면 "이게 전부" 로 오해하십니다.
  return { ids: all.slice(0, SEARCH_BOOK_CAP), capped: all.length > SEARCH_BOOK_CAP };
}

/**
 * 검토할 짝 목록.
 *
 * ⚠️ 두 책을 한 번에 이어붙이지 않고 따로 읽습니다.
 *    같은 표(store_books)를 두 번 이어붙이는 조회는 데이터베이스가
 *    붙여준 이름(외래키 이름)에 기대야 하는데, 그 이름은 표를 다시
 *    만들면 바뀝니다. 조용히 깨질 자리라 나눠서 읽습니다.
 */
export async function getReviewPairs(
  tab: ReviewTab,
  page = 0,
  band: number | null = null,
  size: SizeGroup | null = null,
  q = ""
): Promise<{
  rows: ReviewPair[];
  total: number;
  ok: boolean;
  /** 묶음 크기 필터에서 너무 많아 일부만 훑었으면 true */
  capped?: boolean;
  /** 검색어에 걸린 책이 너무 많아 앞쪽만 봤으면 true */
  searchCapped?: boolean;
}> {
  const supabase = db();
  const decisions = TAB_DECISIONS[tab];

  // ---- 제목으로 찾기 ----
  let searchCapped = false;
  let idFilter: string | null = null;
  if (q.trim()) {
    let found;
    try {
      found = await bookIdsMatching(q);
    } catch {
      return { rows: [], total: 0, ok: false };
    }
    if (!found.ids.length) {
      return { rows: [], total: 0, ok: true };
    }
    searchCapped = found.capped;
    const list = found.ids.join(",");
    idFilter = `store_book_a.in.(${list}),store_book_b.in.(${list})`;
  }

  // 점수 구간을 고르셨으면 **세는 것도 그 구간만** 세야 합니다.
  // 전체 건수로 세면 "3쪽" 이라고 해 놓고 2쪽에서 빈 화면이 나옵니다.
  const range = band === null ? null : bandRange(band);

  let countQuery = supabase
    .from("book_matches")
    .select("id", { count: "exact", head: true })
    .in("decision", decisions);
  if (range) {
    countQuery = countQuery.gte("score", range.lo).lt("score", range.hiExclusive);
  }
  if (idFilter) countQuery = countQuery.or(idFilter);
  const { count } = await countQuery;

  const from = page * PAGE_SIZE;
  let listQuery = supabase
    .from("book_matches")
    .select("id,store_book_a,store_book_b,score,reasons,decision,auto_decision,decided_at")
    // 내가 내린 결정은 최근에 누른 것부터, 나머지는 점수가 높은 것부터.
    // 점수가 높은 쪽이 '맞다' 고 누르기 쉬워서 빨리 줄어듭니다.
    .order(tab === "mine" ? "decided_at" : "score", { ascending: false })
    .in("decision", decisions);
  if (range) {
    listQuery = listQuery.gte("score", range.lo).lt("score", range.hiExclusive);
  }
  if (idFilter) listQuery = listQuery.or(idFilter);
  // ---- 묶음 크기로 좁혀 볼 때 ----
  //
  // ⚠️ 이때는 데이터베이스가 대신 쪽을 나눠 줄 수 없습니다. '몇 권이
  //    묶였나' 는 다른 표(store_books)를 세어야 알 수 있기 때문입니다.
  //    그래서 여기서만 여러 줄을 받아 와서 직접 고릅니다.
  //    너무 많으면 **일부만 봤다고 화면에 적습니다** (조용히 자르지 않음).
  const sizes = size === null ? null : await groupSizes();

  if (size !== null && sizes) {
    const { data: all, error: e0 } = await listQuery.range(0, FILTER_SCAN_CAP - 1);
    if (e0) return { rows: [], total: 0, ok: false };
    const rowsAll = (all ?? []) as { store_book_a: number }[];
    const kept = rowsAll.filter((m) => {
      const n = sizes.byStoreBook.get(m.store_book_a);
      return n !== undefined && sizeGroupOf(n) === size;
    });
    const pageRows = kept.slice(from, from + PAGE_SIZE);
    const shaped = await shapePairs(
      pageRows as never[],
      sizes.byStoreBook
    );
    return {
      rows: shaped,
      total: kept.length,
      ok: true,
      capped: rowsAll.length >= FILTER_SCAN_CAP,
      searchCapped,
    };
  }

  const { data, error } = await listQuery.range(from, from + PAGE_SIZE - 1);

  if (error) {
    // auto_decision 칸이 없으면 아직 db/auth.sql 을 실행하지 않은 것입니다.
    // 조용히 빈 화면을 띄우지 않고 화면에서 안내합니다.
    return { rows: [], total: count ?? 0, ok: false };
  }

  const matches = (data ?? []) as {
    id: number;
    store_book_a: number;
    store_book_b: number;
    score: number;
    reasons: Record<string, unknown> | null;
    decision: string;
    auto_decision: string | null;
    decided_at: string | null;
  }[];

  if (!matches.length) return { rows: [], total: count ?? 0, ok: true };

  // 크기 필터를 안 켰어도 '몇 권 묶였는지' 는 카드에 보여줍니다.
  // 못 세면 숫자를 지어내지 않고 감춥니다 (null).
  const sz = await groupSizes();
  const rows = await shapePairs(matches, sz.ok ? sz.byStoreBook : null);
  return { rows, total: count ?? 0, ok: true, searchCapped };
}

/**
 * 짝 목록에 책 정보를 붙입니다.
 *
 * ⚠️ 두 책을 한 번에 이어붙이지 않고 따로 읽습니다.
 *    같은 표(store_books)를 두 번 이어붙이는 조회는 데이터베이스가
 *    붙여준 이름(외래키 이름)에 기대야 하는데, 그 이름은 표를 다시
 *    만들면 바뀝니다. 조용히 깨질 자리라 나눠서 읽습니다.
 */
async function shapePairs(
  matches: {
    id: number;
    store_book_a: number;
    store_book_b: number;
    score: number;
    reasons: Record<string, unknown> | null;
    decision: string;
    auto_decision: string | null;
    decided_at: string | null;
  }[],
  sizeByStoreBook: Map<number, number> | null
): Promise<ReviewPair[]> {
  const supabase = db();
  if (!matches.length) return [];

  const ids = [
    ...new Set(matches.flatMap((m) => [m.store_book_a, m.store_book_b])),
  ];

  // ⚠️ 번호를 한 줄에 다 적어서 물어보면 주소가 너무 길어져 데이터베이스가
  //    거절합니다. 화면(20줄)에서는 안 걸리지만 내려받기(수백 줄)에서는
  //    걸립니다. 300개씩 나눠 묻습니다.
  //    또 하나: 나눈 것을 **차례로** 물으면 줄 서서 기다립니다.
  //    갯수 제한 없이 받을 때는 그 기다림이 쌓여 시간 제한에 걸립니다.
  //    4개씩 동시에 묻습니다.
  const ID_CHUNK = 300;
  const LANES = 4;
  const parts: number[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) parts.push(ids.slice(i, i + ID_CHUNK));

  const books: Record<string, unknown>[] = [];
  for (let i = 0; i < parts.length; i += LANES) {
    const got = await Promise.all(
      parts.slice(i, i + LANES).map(async (part) => {
        const { data, error } = await supabase
          .from("store_books")
          .select("id,store_id,raw_title,raw_author,raw_publisher,pub_ym,list_price,isbn13,cover_url,book_id")
          .in("id", part);
        if (error) throw new Error(error.message);
        return (data ?? []) as Record<string, unknown>[];
      })
    ).catch(() => null);
    if (!got) return [];
    for (const g of got) books.push(...g);
  }

  const byId = new Map<number, ReviewBook>();
  for (const b of books) {
    byId.set(b.id as number, {
      id: b.id as number,
      storeId: b.store_id as number,
      title: (b.raw_title as string) ?? "",
      author: (b.raw_author as string) ?? null,
      publisher: (b.raw_publisher as string) ?? null,
      pubYm: (b.pub_ym as string) ?? null,
      listPrice: (b.list_price as number) ?? null,
      isbn13: (b.isbn13 as string) ?? null,
      coverUrl: (b.cover_url as string) ?? null,
      bookId: (b.book_id as number) ?? null,
    });
  }

  const rows: ReviewPair[] = [];
  for (const m of matches) {
    const a = byId.get(m.store_book_a);
    const b = byId.get(m.store_book_b);
    // 한쪽이 지워졌으면 보여줄 수 없습니다. 빈 칸으로 채우지 않습니다.
    if (!a || !b) continue;
    rows.push({
      id: m.id,
      score: m.score,
      reasons: m.reasons ?? {},
      decision: m.decision,
      autoDecision: m.auto_decision,
      decidedAt: m.decided_at,
      a,
      b,
      groupSize: sizeByStoreBook?.get(m.store_book_a) ?? null,
      // 🚨 판정이 아니라 **실제 소속**으로 판단합니다 (위 linked 설명).
      linked: a.bookId !== null && a.bookId === b.bookId,
    });
  }

  return rows;
}

/* ══════════════════════════════════════════════ 엑셀로 내려받기 (많은 줄) */

/**
 * 【2026-08-10 대표님 신고】
 * "엑셀 파일 다운로드 버튼을 눌렀는데 페이지가 한참 로딩중인 것처럼
 *  나오다가 결국 사이트 에러창이 떴다"
 *
 * 파일이 커서가 **아니었습니다.** 내려받기가 화면용 함수를
 * 20줄씩 100번 불렀고, 그때마다 '몇 권 묶였나' 를 처음부터 다시
 * 세고 있었습니다. 한 번에 데이터베이스를 4,000번 넘게 부른 셈입니다.
 * 서버에는 한 요청에 쓸 수 있는 시간 제한이 있어서, 그 시간을 넘기면
 * 아무 파일도 못 받고 오류 화면이 뜹니다.
 *
 * 그래서 내려받기는 화면과 **다른 길**로 갑니다.
 *   · '몇 권 묶였나' 는 **한 번만** 셉니다
 *   · 20줄이 아니라 500줄씩 받아 옵니다
 *   · 다 모은 뒤에 보내지 않고 **받는 대로 조금씩 흘려보냅니다**
 *     (그래야 브라우저가 곧바로 '내려받는 중' 으로 바뀝니다)
 */
const EXPORT_CHUNK = 500;

/**
 * '갯수 제한 없이' 라고 해도 끝없이 돌면 안 됩니다.
 * 여기 걸리면 **파일 안에 잘렸다고 적습니다** (조용히 자르지 않습니다).
 */
const HARD_SCAN_CAP = 100000;

export type ExportStatus = {
  /** 지금까지 보낸 줄 수 */
  sent: number;
  /** 너무 많아서 잘렸는지 */
  capped: boolean;
};

export async function* streamReviewPairs(
  tab: ReviewTab,
  band: number | null,
  size: SizeGroup | null,
  maxRows: number,
  status: ExportStatus,
  q = ""
): AsyncGenerator<ReviewPair[]> {
  const supabase = db();
  const decisions = TAB_DECISIONS[tab];
  const range = band === null ? null : bandRange(band);

  /*
    ⚠️ 화면에서 찾아 놓고 내려받았는데 파일에는 전부 들어 있으면,
       그 파일이 무엇인지 알 수 없습니다. 화면과 파일은 같아야 합니다.
  */
  let idFilter: string | null = null;
  if (q.trim()) {
    const found = await bookIdsMatching(q);
    if (!found.ids.length) return;
    if (found.capped) status.capped = true;
    const list = found.ids.join(",");
    idFilter = `store_book_a.in.(${list}),store_book_b.in.(${list})`;
  }

  // 여기서 딱 한 번만 셉니다 (예전에는 20줄마다 다시 셌습니다)
  const sz = await groupSizes();
  const byStoreBook = sz.ok ? sz.byStoreBook : null;

  if (size !== null && !byStoreBook) {
    // 묶인 권수를 모르면 권수로 고를 수 없습니다.
    // 아무거나 담아서 '된 척' 하면 안 됩니다.
    throw new Error(
      "묶인 권수를 세지 못해 권수로 고른 목록을 만들 수 없습니다. 잠시 뒤 다시 해 보세요."
    );
  }

  // 권수로 좁힐 때는 걸러지는 줄이 있으므로 더 많이 훑어야 합니다.
  // maxRows 가 Infinity(갯수 제한 없음)여도 여기서 멈출 자리는 있어야 합니다.
  const scanCap = Math.min(
    size === null ? maxRows : FILTER_SCAN_CAP,
    HARD_SCAN_CAP
  );

  // ---- '몇 번째부터' 대신 '어디까지 읽었나' 로 읽습니다 ----
  //
  // 🚨 2026-08-10 대표님 신고: 전체를 받았는데 29,502줄에서 끊김.
  //
  //    원인은 **읽는 방식**이었습니다. 예전에는 "29,000번째부터 500줄" 처럼
  //    부탁했습니다. 그러면 데이터베이스는 매번 앞의 29,000줄을 처음부터
  //    다시 세고 다시 줄 세운 다음 뒷부분만 떼어 줍니다. 뒤로 갈수록
  //    한 번이 점점 느려져서, 3만 줄쯤에서 시간 제한(60초)에 걸립니다.
  //
  //    그래서 "마지막으로 읽은 번호 다음부터 500줄" 로 바꿉니다.
  //    몇 번째든 늘 같은 속도입니다.
  //
  //    ⚠️ 덤으로 **조용히 틀리던 것**도 함께 고쳐집니다.
  //       점수순으로 줄을 세우면 같은 점수가 수백 개씩 있습니다. 순서가
  //       매번 달라질 수 있어서, 어떤 줄은 두 번 나오고 어떤 줄은 아예
  //       빠질 수 있었습니다. 번호는 겹치지 않으므로 그런 일이 없습니다.
  //
  //    대신 파일이 점수순이 아니라 번호순이 됩니다. '전체 정리' 용도라
  //    괜찮다고 봤습니다. (조건을 걸고 받는 쪽은 점수순 그대로입니다)
  const byId = maxRows === Infinity;
  let after = 0;

  for (let start = 0; start < scanCap && status.sent < maxRows; start += EXPORT_CHUNK) {
    let qy = supabase
      .from("book_matches")
      .select("id,store_book_a,store_book_b,score,reasons,decision,auto_decision,decided_at")
      .in("decision", decisions);
    if (range) qy = qy.gte("score", range.lo).lt("score", range.hiExclusive);
    if (idFilter) qy = qy.or(idFilter);

    qy = byId
      ? qy.order("id", { ascending: true }).gt("id", after).limit(EXPORT_CHUNK)
      : qy
          .order(tab === "mine" ? "decided_at" : "score", { ascending: false })
          // 같은 점수끼리 순서가 흔들리지 않게 번호로 한 번 더 줄 세웁니다
          .order("id", { ascending: true })
          .range(start, start + EXPORT_CHUNK - 1);

    const { data, error } = await qy;
    if (error) throw new Error(error.message);

    const got = (data ?? []) as Parameters<typeof shapePairs>[0];
    if (!got.length) return;
    if (byId) after = got[got.length - 1].id;

    let use = got;
    if (size !== null && byStoreBook) {
      use = got.filter((m) => {
        const n = byStoreBook.get(m.store_book_a);
        return n !== undefined && sizeGroupOf(n) === size;
      });
    }
    if (use.length > maxRows - status.sent) {
      use = use.slice(0, maxRows - status.sent);
      status.capped = true;
    }

    if (use.length) {
      const shaped = await shapePairs(use, byStoreBook);
      status.sent += shaped.length;
      yield shaped;
    }

    // 덜 받아 왔으면 더 없는 것입니다
    if (got.length < EXPORT_CHUNK) return;
  }

  // 여기까지 왔는데 아직 남았다면 훑는 한도에 걸린 것입니다
  if (status.sent >= maxRows || size !== null) status.capped = true;
}

/* ═══════════════════════════════ 전체 내려받기 — 브라우저가 나눠서 가져감 */

/**
 * 【2026-08-10 — 두 번 잘린 뒤에 방식을 바꿉니다】
 * 29,502줄에서 끊겨서 읽는 방식을 고쳤더니 36,002줄에서 끊겼습니다.
 * 나아지긴 했지만 **여전히 한 번의 요청 안에 끝내려는 구조**입니다.
 * 서버에는 요청 하나에 60초 제한이 있어서, 자료가 늘면 언젠가 또 걸립니다.
 * 같은 사고를 세 번째 겪으시게 할 수는 없습니다.
 *
 * 그래서 **한 번에 다 만들지 않습니다.**
 * 브라우저가 500줄씩 여러 번 나눠서 가져가고, 다 모은 뒤에 파일로
 * 저장합니다. 요청 하나하나는 1초도 안 걸리므로 제한에 걸릴 일이 없습니다.
 * 대표님 화면에는 "지금까지 몇 줄" 이 계속 보입니다.
 *
 * 이 함수는 그 '한 조각' 을 만듭니다.
 */
export type ExportChunk = {
  rows: ReviewPair[];
  /** 다음에 이어서 가져갈 번호. null 이면 이 칸은 끝입니다. */
  next: number | null;
};

export async function getExportChunk(
  tab: ReviewTab,
  after: number,
  limit: number
): Promise<ExportChunk> {
  const supabase = db();

  const { data, error } = await supabase
    .from("book_matches")
    .select("id,store_book_a,store_book_b,score,reasons,decision,auto_decision,decided_at")
    .in("decision", TAB_DECISIONS[tab])
    .gt("id", after)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const matches = (data ?? []) as Parameters<typeof shapePairs>[0];
  if (!matches.length) return { rows: [], next: null };

  // 묶인 권수도 **이 조각에 나오는 책만** 셉니다.
  // 예전에는 표 전체(수십만 줄)를 훑었습니다. 그게 느림의 큰 몫이었습니다.
  const sizes = await groupSizesFor(matches.map((m) => m.store_book_a));
  const rows = await shapePairs(matches, sizes);

  const last = matches[matches.length - 1].id;
  return { rows, next: matches.length < limit ? null : last };
}

/**
 * 주어진 서점도서들이 각각 몇 권짜리 묶음에 속하는지.
 * 표 전체를 훑지 않고, **그 책들이 속한 묶음만** 봅니다.
 */
async function groupSizesFor(
  storeBookIds: number[]
): Promise<Map<number, number> | null> {
  const supabase = db();
  const ids = [...new Set(storeBookIds)];
  if (!ids.length) return new Map();

  try {
    // ① 이 서점도서들이 어느 책(book_id)에 묶여 있는지
    const bookOf = new Map<number, number>();
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await supabase
        .from("store_books")
        .select("id,book_id")
        .in("id", ids.slice(i, i + 300));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        if (r.book_id != null) bookOf.set(r.id as number, r.book_id as number);
      }
    }

    // ② 그 책들에 묶인 서점도서가 모두 몇 개인지
    const bookIds = [...new Set([...bookOf.values()])];
    const perBook = new Map<number, number>();
    for (let i = 0; i < bookIds.length; i += 300) {
      const { data, error } = await supabase
        .from("store_books")
        .select("book_id")
        .in("book_id", bookIds.slice(i, i + 300));
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const b = r.book_id as number;
        perBook.set(b, (perBook.get(b) ?? 0) + 1);
      }
    }

    const out = new Map<number, number>();
    for (const [sb, b] of bookOf) out.set(sb, perBook.get(b) ?? 0);
    return out;
  } catch {
    // 못 세면 **틀린 숫자 대신 빈칸**입니다.
    return null;
  }
}

/** 탭마다 몇 건씩 남았는지 (탭 옆 숫자) */
export async function getReviewCounts(): Promise<Record<ReviewTab, number>> {
  const supabase = db();
  const out: Record<ReviewTab, number> = { pending: 0, merged: 0, mine: 0 };
  await Promise.all(
    (Object.keys(TAB_DECISIONS) as ReviewTab[]).map(async (tab) => {
      const { count } = await supabase
        .from("book_matches")
        .select("id", { count: "exact", head: true })
        .in("decision", TAB_DECISIONS[tab]);
      out[tab] = count ?? 0;
    })
  );
  return out;
}

export const REVIEW_PAGE_SIZE = PAGE_SIZE;

/**
 * 왜 이 점수가 나왔는지 사람 말로.
 *
 * ⚠️ 여기 적는 값은 crawler/common/match.py 가 실제로 저장하는 값입니다.
 *    처음에 제가 true/false 로 짐작해서 썼다가, 실제 값이
 *    "exact" / "similar(0.85)" / "different(0.42)" / "missing" 인 것을
 *    보고 고쳤습니다. 짐작으로 쓰면 화면이 조용히 거짓말을 합니다.
 *
 * 모르는 값이 오면 감추지 않고 그대로 보여줍니다.
 * 감추면 매칭 규칙이 바뀐 것을 아무도 눈치채지 못합니다.
 */
export type Reason = { label: string; tone: "good" | "bad" | "plain" };

export function reasonText(reasons: Record<string, unknown>): Reason[] {
  const out: Reason[] = [];

  const sim = reasons.title_sim;
  if (typeof sim === "number") {
    out.push({
      label: `제목 ${Math.round(sim * 100)}% 닮음`,
      tone: sim >= 0.9 ? "good" : sim >= 0.75 ? "plain" : "bad",
    });
  }

  for (const [key, name] of [
    ["author", "저자"],
    ["publisher", "출판사"],
  ] as const) {
    const v = reasons[key];
    if (typeof v !== "string") continue;
    if (v === "exact") out.push({ label: `${name} 같음`, tone: "good" });
    else if (v === "missing")
      out.push({ label: `${name} 한쪽이 비어 있음`, tone: "plain" });
    else if (v.startsWith("similar"))
      out.push({ label: `${name} 비슷 ${pct(v)}`, tone: "plain" });
    else if (v.startsWith("different"))
      out.push({ label: `${name} 다름 ${pct(v)}`, tone: "bad" });
    else out.push({ label: `${name} ${v}`, tone: "plain" });
  }

  const ym = reasons.pub_ym;
  if (typeof ym === "string") {
    if (ym === "exact") out.push({ label: "출간월 같음", tone: "good" });
    else if (ym === "missing")
      out.push({ label: "출간월 한쪽이 비어 있음", tone: "plain" });
    else if (ym.startsWith("near"))
      out.push({ label: `출간월 ${inside(ym)} 차이`, tone: "plain" });
    else if (ym.startsWith("different"))
      out.push({ label: `출간월 ${inside(ym)} 차이`, tone: "bad" });
    else out.push({ label: `출간월 ${ym}`, tone: "plain" });
  }

  if (reasons.isbn13 === "exact")
    out.push({ label: "ISBN 같음 (확정)", tone: "good" });
  if (reasons.publisher_unknown === true)
    out.push({ label: "출판사를 몰라 더 엄격히 봄", tone: "plain" });
  if (typeof reasons.rejected_by === "string")
    out.push({ label: `거른 이유: ${reasons.rejected_by}`, tone: "bad" });

  return out;
}

/** "similar(0.85)" → "85%" */
function pct(v: string): string {
  const n = Number(inside(v));
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : inside(v);
}

/** "near(3개월)" → "3개월" */
function inside(v: string): string {
  const m = v.match(/\(([^)]*)\)/);
  return m ? m[1] : v;
}
