/**
 * 채워 온 엑셀의 결정을 **조금씩 나눠서** 반영합니다 — 관리자만.
 *
 * 【왜 나눠서 받나요? — 2026-08-10 대표님 신고】
 *   413: PAYLOAD_TOO_LARGE
 *
 * 파일을 통째로 올리는 방식은 **4.5MB 까지만** 받습니다. 그보다 크면
 * 우리 코드가 실행되기도 전에 서버 앞단에서 거절합니다. 검토 목록이
 * 3만 줄을 넘으면서 파일이 그 선을 넘었습니다.
 *
 * 그래서 **파일을 올리지 않습니다.**
 * 브라우저가 파일을 읽어서 '짝번호와 결정' 만 추려 500건씩 보냅니다.
 * 제목·저자 같은 나머지 칸은 보낼 필요가 없습니다 — 우리가 준 자료니까요.
 * 3만 건이라도 한 번에 가는 양은 10KB 안팎입니다.
 *
 * 부르는 쪽: web/components/ImportSheet.tsx
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole, db } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번에 받을 수 있는 최대 건수 (브라우저도 이 크기로 나눠 보냅니다) */
const MAX_PER_CALL = 500;

type Incoming = { id: number; action: "merge" | "split" | "undo" };

export async function POST(request: NextRequest) {
  if ((await currentRole()) !== "admin") {
    return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  }

  let rows: Incoming[];
  try {
    const body = (await request.json()) as { rows?: unknown };
    if (!Array.isArray(body.rows)) throw new Error("rows 가 없습니다.");
    rows = body.rows as Incoming[];
  } catch (e) {
    return NextResponse.json(
      { error: `보낸 내용을 못 읽었습니다: ${e instanceof Error ? e.message : e}` },
      { status: 400 }
    );
  }

  if (rows.length > MAX_PER_CALL) {
    return NextResponse.json(
      { error: `한 번에 ${MAX_PER_CALL}건까지입니다.` },
      { status: 400 }
    );
  }

  // 이상한 값이 섞여 있으면 **한 건도 반영하지 않습니다.**
  for (const r of rows) {
    if (!Number.isInteger(r?.id) || r.id <= 0) {
      return NextResponse.json({ error: `짝번호가 이상합니다: ${r?.id}` }, { status: 400 });
    }
    if (r.action !== "merge" && r.action !== "split" && r.action !== "undo") {
      return NextResponse.json({ error: `모르는 결정: ${r?.action}` }, { status: 400 });
    }
  }

  const supabase = db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "로그인이 풀렸습니다." }, { status: 403 });
  }

  // ---- '되돌리기' 는 원래 판단을 먼저 읽어야 합니다 ----
  const undoIds = rows.filter((r) => r.action === "undo").map((r) => r.id);
  const autoOf = new Map<number, string | null>();
  if (undoIds.length) {
    const { data } = await supabase
      .from("book_matches")
      .select("id,auto_decision")
      .in("id", undoIds);
    for (const r of data ?? []) {
      autoOf.set(Number(r.id), (r.auto_decision as string) ?? null);
    }
  }

  let applied = 0;
  let failed = 0;
  let noAuto = 0;

  // 같은 값으로 바꾸는 것끼리 묶으면 요청이 줄어듭니다.
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    let decision: string | null;
    if (r.action === "undo") {
      const auto = autoOf.get(r.id);
      if (!auto) {
        // 원래 판단을 모르면 되돌릴 수 없습니다.
        // 아무 값이나 넣어 '되돌린 척' 하면 안 됩니다.
        noAuto++;
        continue;
      }
      decision = auto;
    } else {
      decision = r.action === "merge" ? "manual_merge" : "manual_split";
    }
    const key = `${decision}|${r.action === "undo" ? "undo" : "manual"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r.id);
  }

  for (const [key, ids] of groups) {
    const [decision, mode] = key.split("|");
    const { data, error } = await supabase
      .from("book_matches")
      .update({
        decision,
        // 되돌린 것은 '사람이 내린 결정' 이 아니므로 흔적을 지웁니다.
        decided_by: mode === "undo" ? null : auth.user.id,
        decided_at: mode === "undo" ? null : new Date().toISOString(),
      })
      .in("id", ids)
      .select("id");

    // ⚠️ 오류가 없어도 안심하면 안 됩니다.
    //    보안 규칙에 막히면 **오류 없이 0줄**이 바뀝니다.
    if (error) {
      failed += ids.length;
    } else {
      const n = (data ?? []).length;
      applied += n;
      failed += ids.length - n;
    }
  }

  return NextResponse.json({ applied, failed, noAuto });
}
