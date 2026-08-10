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

/**
 * 내려받을 범위. 탭 하나이거나, **세 탭 전부**입니다.
 *
 * 【2026-08-10 대표님 요청】
 * "검토 대기와 자동으로 묶은 것, 내가 내린 결정까지 갯수 제한 없이
 *  한번에 다 다운로드 할 수 있게 해줬으면 좋겠어. 한번에 정리할 수 있게."
 */
export type ExportScope = ReviewTab | "all";

export function isExportScope(v: string | undefined): v is ExportScope {
  return v === "all" || isReviewTab(v);
}

/** 그 범위에서 읽어야 할 decision 값들 */
function decisionsOf(scope: ExportScope): string[] {
  if (scope !== "all") return TAB_DECISIONS[scope];
  // 세 탭을 합칩니다. 중복은 없지만 Set 으로 한 번 걸러 둡니다.
  return [...new Set(Object.values(TAB_DECISIONS).flat())];
}

/**
 * 저장된 값 → 사람이 읽을 말.
 *
 * 세 탭을 한 파일로 받으면 **어느 탭에서 온 줄인지 알 수 없게 됩니다.**
 * 그래서 '구분' 칸에 이 말을 적습니다.
 * 모르는 값이 오면 감추지 않고 그대로 적습니다 (매칭 규칙이 바뀐 것을
 * 아무도 눈치 못 채면 안 됩니다).
 */
export const DECISION_LABEL: Record<string, string> = {
  auto_low: "검토 대기",
  auto_high: "자동으로 묶은 것",
  manual_merge: "내 결정 · 같은 책",
  manual_split: "내 결정 · 다른 책",
};

export function decisionLabel(decision: string): string {
  return DECISION_LABEL[decision] ?? decision;
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
};

const PAGE_SIZE = 20;

/**
 * 묶음 크기를 세려면 store_books 를 통째로 봐야 합니다.
 * 이 숫자보다 많으면 세는 것을 포기하고 **모른다고 말합니다.**
 * (조용히 틀린 숫자를 보여주는 것보다 낫습니다)
 */
const SIZE_SCAN_CAP = 40000;

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
  size: SizeGroup | null = null
): Promise<{
  rows: ReviewPair[];
  total: number;
  ok: boolean;
  /** 묶음 크기 필터에서 너무 많아 일부만 훑었으면 true */
  capped?: boolean;
}> {
  const supabase = db();
  const decisions = TAB_DECISIONS[tab];

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
  return { rows, total: count ?? 0, ok: true };
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
  const ID_CHUNK = 300;
  const books: Record<string, unknown>[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error: e2 } = await supabase
      .from("store_books")
      .select("id,store_id,raw_title,raw_author,raw_publisher,pub_ym,isbn13,cover_url,book_id")
      .in("id", ids.slice(i, i + ID_CHUNK));
    if (e2) return [];
    books.push(...((data ?? []) as Record<string, unknown>[]));
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

export type ExportStatus = {
  /** 지금까지 보낸 줄 수 */
  sent: number;
  /** 개수 상한에 걸려 잘렸는지 */
  capped: boolean;
  /**
   * 시간이 다 되어 멈췄는지.
   *
   * 【2026-08-10 대표님 요청 — "갯수 제한 없이 한번에 다"】
   * 개수 상한은 없앴습니다. 그런데 서버가 한 요청에 쓸 수 있는 시간은
   * 60초로 정해져 있어서(route 의 maxDuration), 자료가 아주 많으면
   * 시간이 먼저 끝납니다. 그때 조용히 멈추면 **받다 만 파일을 전부로
   * 오해**하십니다. 그래서 따로 표시하고 파일 안에도 적습니다.
   */
  timedOut: boolean;
};

/** 상태값의 기본형 — 부르는 쪽에서 칸을 빠뜨리지 않도록 */
export function newExportStatus(): ExportStatus {
  return { sent: 0, capped: false, timedOut: false };
}

/**
 * 검토 짝을 조금씩 흘려보냅니다.
 *
 * @param maxRows  최대 줄 수. **null 이면 개수 제한 없음** (시간으로만 멈춥니다)
 * @param deadline 이 시각(Date.now() 기준 ms)을 넘기면 멈춥니다. null 이면 무제한
 */
export async function* streamReviewPairs(
  scope: ExportScope,
  band: number | null,
  size: SizeGroup | null,
  maxRows: number | null,
  status: ExportStatus,
  deadline: number | null = null
): AsyncGenerator<ReviewPair[]> {
  const supabase = db();
  const decisions = decisionsOf(scope);
  const range = band === null ? null : bandRange(band);

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

  const outOfTime = () => deadline !== null && Date.now() >= deadline;

  for (let start = 0; ; start += EXPORT_CHUNK) {
    if (maxRows !== null && status.sent >= maxRows) {
      status.capped = true;
      return;
    }
    if (outOfTime()) {
      status.timedOut = true;
      return;
    }
    // 권수로 좁힐 때는 걸러지는 줄이 있어 훑는 양이 훨씬 많습니다.
    // 이때만 훑는 한도를 둡니다.
    if (size !== null && start >= FILTER_SCAN_CAP) {
      status.capped = true;
      return;
    }

    let q = supabase
      .from("book_matches")
      .select("id,store_book_a,store_book_b,score,reasons,decision,auto_decision,decided_at")
      .order(scope === "mine" ? "decided_at" : "score", { ascending: false })
      // 🚨 두 번째 기준(id)이 없으면 안 됩니다.
      //    점수가 같은 줄이 수천 건이면, 쪽을 넘길 때마다 순서가 달라져서
      //    **어떤 줄은 두 번 나오고 어떤 줄은 아예 빠집니다.**
      //    2,000건까지는 잘 드러나지 않던 자리인데, 제한을 푸는 순간
      //    바로 문제가 됩니다.
      .order("id", { ascending: true })
      .in("decision", decisions);
    if (range) q = q.gte("score", range.lo).lt("score", range.hiExclusive);

    const { data, error } = await q.range(start, start + EXPORT_CHUNK - 1);
    if (error) throw new Error(error.message);

    const got = (data ?? []) as Parameters<typeof shapePairs>[0];
    if (!got.length) return;

    let use = got;
    if (size !== null && byStoreBook) {
      use = got.filter((m) => {
        const n = byStoreBook.get(m.store_book_a);
        return n !== undefined && sizeGroupOf(n) === size;
      });
    }
    if (maxRows !== null && use.length > maxRows - status.sent) {
      use = use.slice(0, maxRows - status.sent);
      status.capped = true;
    }

    if (use.length) {
      const shaped = await shapePairs(use, byStoreBook);
      status.sent += shaped.length;
      yield shaped;
    }

    // 덜 받아 왔으면 더 없는 것입니다 (여기서 끝나면 잘린 게 아닙니다)
    if (got.length < EXPORT_CHUNK) return;
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
