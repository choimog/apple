/**
 * '같은 책 / 다른 책' 결정을 저장합니다.
 *
 * 【이 파일이 이 사이트에서 유일하게 자료를 바꾸는 곳입니다】
 * 그래서 문을 세 겹으로 두었습니다.
 *
 *   1. 로그인했는가          — middleware.ts
 *   2. 관리자인가            — 여기서 한 번 (사람이 읽을 안내를 위해)
 *   3. 관리자인가            — 데이터베이스에서 다시 (db/auth.sql 의 규칙)
 *
 * 2번만 있으면 안 됩니다. 화면 코드는 언제든 실수로 빠질 수 있고,
 * 그러면 아무나 자료를 고치게 됩니다. 3번이 진짜 자물쇠입니다.
 * 2번은 "권한이 없습니다" 를 한국어로 알려주기 위한 것입니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole, db } from "@/lib/supabase";

/** 화면에서 누를 수 있는 것 */
const ACTIONS = {
  // 사람이 "맞다" 고 누름 — 자동 로직이 절대 못 뒤집습니다
  merge: "manual_merge",
  // 사람이 "아니다" 고 누름 — 영구 블랙리스트
  split: "manual_split",
  // 되돌리기 — 자동 판단으로 되돌립니다
  undo: null,
} as const;

type Action = keyof typeof ACTIONS;

function isAction(v: string): v is Action {
  return v === "merge" || v === "split" || v === "undo";
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const id = Number(form.get("id"));
  const action = String(form.get("action") ?? "");
  const back = safeBack(form.get("back"));

  const to = (code: string) => {
    const url = new URL(back, request.url);
    url.searchParams.set("msg", code);
    return NextResponse.redirect(url, { status: 303 });
  };

  if (!Number.isInteger(id) || id <= 0) return to("badid");
  if (!isAction(action)) return to("badaction");

  // ---- 관리자인지 (사람이 읽을 안내용) ----
  const role = await currentRole();
  if (role !== "admin") return to("notadmin");

  const supabase = db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return to("notadmin");

  // ---- 되돌리기: 자동 판단이 무엇이었는지 먼저 읽어야 합니다 ----
  let decision: string;
  if (action === "undo") {
    const { data, error } = await supabase
      .from("book_matches")
      .select("auto_decision")
      .eq("id", id)
      .maybeSingle();
    if (error) return to("dberror");
    const auto = data?.auto_decision;
    // 원래 판단을 모르면 되돌릴 수 없습니다.
    // 아무 값이나 넣어서 '되돌린 척' 하면 안 됩니다.
    if (!auto) return to("noauto");
    decision = auto;
  } else {
    decision = ACTIONS[action]!;
  }

  const { data: changed, error } = await supabase
    .from("book_matches")
    .update({
      decision,
      // 되돌린 것은 '사람이 내린 결정' 이 아니므로 흔적을 지웁니다.
      // 안 지우면 '내가 내린 결정' 목록에 계속 남습니다.
      decided_by: action === "undo" ? null : auth.user.id,
      decided_at: action === "undo" ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");

  if (error) {
    // 권한이 없으면 데이터베이스가 막습니다 (3번 문).
    if (/permission|policy|denied/i.test(error.message)) return to("notadmin");
    if (/auto_decision|column/i.test(error.message)) return to("needsql");
    return to("dberror");
  }

  /**
   * ⚠️ 오류가 없어도 안심하면 안 됩니다.
   *    보안 규칙에 막히면 '고칠 줄을 못 찾은 것' 이 되어 오류 없이
   *    0줄이 바뀝니다. 그대로 성공이라고 하면, 대표님은 눌렀는데
   *    아무 일도 안 일어난 것을 모르게 됩니다.
   */
  if (!changed?.length) return to("nochange");

  return to(action === "undo" ? "undone" : action === "merge" ? "merged" : "split");
}

/**
 * 돌아갈 곳. 우리 사이트 안이어야 합니다.
 * ('//남의사이트' 는 우리 주소가 아닙니다)
 */
function safeBack(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  return s.startsWith("/review") && !s.startsWith("//") ? s : "/review";
}
