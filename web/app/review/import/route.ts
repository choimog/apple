/**
 * 채워 온 엑셀(CSV)을 올려서 결정을 한꺼번에 반영합니다 — 관리자만.
 *
 * 【이 파일이 한 번에 가장 많은 자료를 바꿉니다】
 * 그래서 지키는 것:
 *
 *  1. 엉뚱한 파일이면 **한 줄도 반영하지 않고** 왜 안 되는지 말합니다.
 *     "완료" 라고 뜨는데 아무것도 안 바뀐 상태가 가장 위험합니다.
 *  2. 몇 건 반영 / 건너뜀 / 실패인지 **숫자로** 알려줍니다.
 *  3. '되돌리기' 는 원래 판단을 알 때만 합니다. 모르면 건너뜁니다.
 *  4. 관리자 확인은 여기서 한 번, 데이터베이스에서 또 합니다.
 *     여기 것은 한국어 안내용이고, 진짜 자물쇠는 데이터베이스입니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole, db } from "@/lib/supabase";
import { parseSheet } from "@/lib/review-sheet";

/** 시간이 오래 걸릴 수 있습니다 (무료 요금제 최대치) */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * 한 번에 반영할 수 있는 최대 줄 수.
 *
 * 【2026-08-10】 내려받기를 '갯수 제한 없이' 로 바꿨는데 올리는 쪽이
 * 2,000줄이면, 받은 파일을 다 채워 올렸을 때 통째로 거절당합니다.
 * 받을 수 있는 만큼은 올릴 수 있어야 합니다.
 */
const MAX_APPLY = 100000;

export async function POST(request: NextRequest) {
  const back = new URL("/review", request.url);
  const to = (params: Record<string, string>) => {
    for (const [k, v] of Object.entries(params)) back.searchParams.set(k, v);
    return NextResponse.redirect(back, { status: 303 });
  };

  if ((await currentRole()) !== "admin") return to({ msg: "notadmin" });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return to({ msg: "nofile" });
  }
  // 너무 큰 파일은 아예 안 읽습니다 (2,000줄이면 1MB 를 한참 밑돕니다)
  if (file.size > 5_000_000) return to({ msg: "toobig" });

  const parsed = parseSheet(await file.text());

  // 🚨 파일이 잘못됐으면 **아무것도 반영하지 않습니다.**
  if (parsed.fatal) {
    return to({ msg: "badfile", why: parsed.fatal });
  }
  if (parsed.rows.length === 0) {
    return to({
      msg: "nothing",
      blank: String(parsed.blank),
      unknown: String(parsed.unknown.length),
    });
  }
  if (parsed.rows.length > MAX_APPLY) {
    return to({ msg: "toomany", n: String(parsed.rows.length) });
  }

  const supabase = db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return to({ msg: "notadmin" });

  // ---- '되돌리기' 는 원래 판단을 먼저 읽어야 합니다 ----
  const undoIds = parsed.rows.filter((r) => r.action === "undo").map((r) => r.id);
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
  for (const r of parsed.rows) {
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

  // 수만 줄을 200개씩 **차례로** 고치면 줄 서서 기다리다 시간 제한에
  // 걸립니다. 4묶음씩 동시에 보냅니다.
  const LANES = 4;
  for (const [key, ids] of groups) {
    const [decision, mode] = key.split("|");
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));

    for (let i = 0; i < chunks.length; i += LANES) {
      const results = await Promise.all(
        chunks.slice(i, i + LANES).map(async (chunk) => {
          const { data, error } = await supabase
            .from("book_matches")
            .update({
              decision,
              // 되돌린 것은 '사람이 내린 결정' 이 아니므로 흔적을 지웁니다.
              decided_by: mode === "undo" ? null : auth.user!.id,
              decided_at: mode === "undo" ? null : new Date().toISOString(),
            })
            .in("id", chunk)
            .select("id");
          return { n: chunk.length, got: error ? 0 : (data ?? []).length };
        })
      );
      // ⚠️ 오류가 없어도 안심하면 안 됩니다.
      //    보안 규칙에 막히면 **오류 없이 0줄**이 바뀝니다.
      for (const r of results) {
        applied += r.got;
        failed += r.n - r.got;
      }
    }
  }

  return to({
    msg: "imported",
    ok: String(applied),
    skip: String(parsed.blank),
    bad: String(parsed.unknown.length + parsed.badId.length),
    noauto: String(noAuto),
    fail: String(failed),
  });
}
