/**
 * 강제로 묶기 — 고른 상품들을 '같은 책' 으로 이어 붙입니다.
 *
 * 【이 파일도 자료를 바꿉니다. 문을 세 겹으로 둡니다】
 *   1. 로그인했는가        — middleware.ts
 *   2. 관리자인가          — 여기서 (사람이 읽을 안내를 위해)
 *   3. 관리자인가 + 만들 수 있는 줄인가 — 데이터베이스에서 다시
 *                            (db/force-join.sql 의 규칙)
 *
 * 2번만 있으면 안 됩니다. 화면 코드는 언제든 실수로 빠질 수 있습니다.
 * 3번이 진짜 자물쇠입니다.
 *
 * 【이미 있는 짝과 없는 짝을 나눠서 처리합니다】
 * 검토 대기(auto_low)처럼 이미 저장된 짝은 **판정만 고칩니다**(UPDATE).
 * 규칙이 거부한 짝은 저장돼 있지 않으니 **새로 만듭니다**(INSERT).
 * 둘을 한 번에 하는 방법(upsert)도 있지만, 그러면 고칠 수 있는 칸을
 * 더 많이 열어 줘야 해서 일부러 나눴습니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole, db } from "@/lib/supabase";
import { MAX_JOIN, pairsOf } from "@/lib/join-pairs";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const back = safeBack(form.get("back"));

  const to = (code: string, extra: Record<string, string> = {}) => {
    const url = new URL(back, request.url);
    url.searchParams.set("msg", code);
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return NextResponse.redirect(url, { status: 303 });
  };

  // ---- 무엇을 고르셨나 ----
  const ids = [
    ...new Set(
      form
        .getAll("id")
        .map((v) => Number(v))
        .filter((n) => Number.isInteger(n) && n > 0)
    ),
  ];
  if (ids.length < 2) return to("needtwo");
  if (ids.length > MAX_JOIN) return to("toomany", { max: String(MAX_JOIN) });

  // ---- 관리자인지 (사람이 읽을 안내용) ----
  const role = await currentRole();
  if (role !== "admin") return to("notadmin");

  const supabase = db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return to("notadmin");

  // ---- 진짜 있는 상품인지 확인합니다 ----
  //  없는 번호를 보내면 저장이 통째로 실패합니다. 미리 걸러 냅니다.
  const { data: found, error: findErr } = await supabase
    .from("store_books")
    .select("id")
    .in("id", ids);
  if (findErr) return to("dberror");
  if ((found?.length ?? 0) !== ids.length) return to("gone");

  const pairs = pairsOf(ids);
  const now = new Date().toISOString();

  // ---- 이미 저장돼 있는 짝을 찾습니다 ----
  //  PostgREST 로 (a,b) 짝을 한 번에 묻기가 어려워, 후보를 넉넉히 읽고
  //  코드에서 걸러 냅니다. 고른 것이 최대 6권이라 아주 작은 조회입니다.
  const { data: existRows, error: existErr } = await supabase
    .from("book_matches")
    .select("id,store_book_a,store_book_b")
    .in("store_book_a", ids)
    .in("store_book_b", ids);
  if (existErr) return to("dberror");

  const existing = new Map<string, number>();
  for (const r of existRows ?? []) {
    existing.set(`${r.store_book_a}-${r.store_book_b}`, r.id as number);
  }

  const toUpdate: number[] = [];
  const toInsert: Record<string, unknown>[] = [];
  for (const [a, b] of pairs) {
    const id = existing.get(`${a}-${b}`);
    if (id !== undefined) {
      toUpdate.push(id);
    } else {
      toInsert.push({
        store_book_a: a,
        store_book_b: b,
        score: 0, // 기계가 매긴 점수가 아닙니다. 사람이 이어 붙인 것입니다.
        reasons: { forced_by_person: true },
        decision: "manual_merge",
        // 되돌리면 기계 판단인 '다른 책' 으로 갑니다 (= 없던 일이 됩니다).
        // 이 값이 비면 [되돌리기] 가 거부됩니다.
        auto_decision: "rejected",
        decided_by: auth.user.id,
        decided_at: now,
      });
    }
  }

  let done = 0;

  if (toUpdate.length) {
    const { data: changed, error } = await supabase
      .from("book_matches")
      .update({
        decision: "manual_merge",
        decided_by: auth.user.id,
        decided_at: now,
      })
      .in("id", toUpdate)
      .select("id");
    if (error) return failure(error.message, to);
    done += changed?.length ?? 0;
  }

  if (toInsert.length) {
    const { data: made, error } = await supabase
      .from("book_matches")
      .insert(toInsert)
      .select("id");
    if (error) return failure(error.message, to);
    done += made?.length ?? 0;
  }

  /**
   * ⚠️ 오류가 없어도 안심하면 안 됩니다.
   *    보안 규칙에 막히면 오류 없이 0줄이 바뀝니다. 그대로 성공이라고
   *    하면, 대표님은 눌렀는데 아무 일도 안 일어난 것을 모르십니다.
   */
  if (done !== pairs.length) {
    return to("partial", { ok: String(done), want: String(pairs.length) });
  }

  return to("joined", { n: String(ids.length), pairs: String(pairs.length) });
}

function failure(message: string, to: (c: string, e?: Record<string, string>) => NextResponse) {
  if (/permission|policy|denied|row-level/i.test(message)) return to("needsql");
  if (/auto_decision|column/i.test(message)) return to("needsql");
  return to("dberror");
}

/** 돌아갈 곳. 우리 사이트 안이어야 합니다 ('//남의사이트' 는 우리 주소가 아닙니다) */
function safeBack(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/review") && !s.startsWith("//") ? s : "/review/join";
}
