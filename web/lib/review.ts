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
};

const PAGE_SIZE = 20;

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
  page = 0
): Promise<{ rows: ReviewPair[]; total: number; ok: boolean }> {
  const supabase = db();
  const decisions = TAB_DECISIONS[tab];

  const { count } = await supabase
    .from("book_matches")
    .select("id", { count: "exact", head: true })
    .in("decision", decisions);

  const from = page * PAGE_SIZE;
  const { data, error } = await supabase
    .from("book_matches")
    .select("id,store_book_a,store_book_b,score,reasons,decision,auto_decision,decided_at")
    // 내가 내린 결정은 최근에 누른 것부터, 나머지는 점수가 높은 것부터.
    // 점수가 높은 쪽이 '맞다' 고 누르기 쉬워서 빨리 줄어듭니다.
    .order(tab === "mine" ? "decided_at" : "score", { ascending: false })
    .in("decision", decisions)
    .range(from, from + PAGE_SIZE - 1);

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

  const ids = [
    ...new Set(matches.flatMap((m) => [m.store_book_a, m.store_book_b])),
  ];
  const { data: books, error: e2 } = await supabase
    .from("store_books")
    .select("id,store_id,raw_title,raw_author,raw_publisher,pub_ym,isbn13,cover_url,book_id")
    .in("id", ids);
  if (e2) return { rows: [], total: count ?? 0, ok: false };

  const byId = new Map<number, ReviewBook>();
  for (const b of books ?? []) {
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
    });
  }

  return { rows, total: count ?? 0, ok: true };
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
