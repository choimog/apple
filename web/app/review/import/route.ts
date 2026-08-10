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

/**
 * 이 요청에 쓸 수 있는 시간(초).
 *
 * 【2026-08-10 — 여기에 이 줄이 없었습니다】
 * 없으면 기본 10초입니다. 2,000건 상한은 사실 그 10초에 맞춘 숫자였습니다.
 * 내려받기(sheet/route.ts)에는 이미 60초로 적혀 있었는데 올리기에는
 * 빠져 있어서, 받는 쪽만 커지고 올리는 쪽이 못 따라가던 상태였습니다.
 */
export const maxDuration = 60;

/**
 * 한 번에 반영할 수 있는 최대 줄 수.
 *
 * 【2026-08-10 대표님 요청 — "한번에 정리할 수 있게"】
 * 전부 내려받아 채우셨는데 올릴 때 2,000건에서 막히면 '한번에' 가
 * 아닙니다. 그래서 크게 올렸습니다.
 *
 * ⚠️ 그래도 무제한은 아닙니다. 진짜 한계는 개수가 아니라 **위의 60초**라,
 *    시간이 다 되면 **거기까지 반영하고 몇 건이 남았는지 알려 드립니다.**
 *    (조용히 멈추면 "다 됐다" 고 오해하십니다)
 */
const MAX_APPLY = 50000;

/** 시간이 다 되기 10초 전에 멈추고 결과를 알려 드립니다 */
const TIME_BUDGET_MS = 50_000;

/** 한 번에 물어볼 수 있는 짝번호 개수 (주소가 길어지면 거절당합니다) */
const ID_CHUNK = 300;

export async function POST(request: NextRequest) {
  // ⚠️ 시계는 **맨 처음에** 맞춥니다. 큰 파일은 읽고 해석하는 데만도
  //    몇 초가 걸리는데, 그 뒤에 시계를 맞추면 그 시간이 예산에서 빠져
  //    결국 60초를 넘겨 서버가 요청을 끊습니다.
  const deadline = Date.now() + TIME_BUDGET_MS;

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
  // 너무 큰 파일은 아예 안 읽습니다.
  // (5만 줄이면 20MB 안쪽입니다 — 상한을 올렸으니 여기도 같이 올립니다)
  if (file.size > 30_000_000) return to({ msg: "toobig" });

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
  // ⚠️ 번호를 한 줄에 다 적어서 물어보면 주소가 너무 길어져 데이터베이스가
  //    거절합니다. 2,000건까지는 안 걸리던 자리인데 상한을 올렸으니
  //    여기도 나눠서 물어봐야 합니다. (lib/review.ts 와 같은 이유입니다)
  for (let i = 0; i < undoIds.length; i += ID_CHUNK) {
    const { data } = await supabase
      .from("book_matches")
      .select("id,auto_decision")
      .in("id", undoIds.slice(i, i + ID_CHUNK));
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

  // 시간이 다 되면 멈추고, **몇 건이 남았는지 세어서** 알려 드립니다.
  // 조용히 멈추면 "다 반영됐다" 고 오해하십니다. (시계는 맨 위에서 맞췄습니다)
  const planned = [...groups.values()].reduce((n, ids) => n + ids.length, 0);
  let ranOutOfTime = false;

  outer: for (const [key, ids] of groups) {
    const [decision, mode] = key.split("|");
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);

      if (Date.now() >= deadline) {
        ranOutOfTime = true;
        break outer;
      }

      const { data, error } = await supabase
        .from("book_matches")
        .update({
          decision,
          // 되돌린 것은 '사람이 내린 결정' 이 아니므로 흔적을 지웁니다.
          decided_by: mode === "undo" ? null : auth.user.id,
          decided_at: mode === "undo" ? null : new Date().toISOString(),
        })
        .in("id", chunk)
        .select("id");

      // ⚠️ 오류가 없어도 안심하면 안 됩니다.
      //    보안 규칙에 막히면 **오류 없이 0줄**이 바뀝니다.
      if (error) {
        failed += chunk.length;
      } else {
        const n = (data ?? []).length;
        applied += n;
        failed += chunk.length - n;
      }
    }
  }

  // 손도 못 댄 줄 수 = 하려던 것 − (반영 + 실패)
  const left = ranOutOfTime ? Math.max(0, planned - applied - failed) : 0;

  return to({
    msg: "imported",
    ok: String(applied),
    skip: String(parsed.blank),
    bad: String(parsed.unknown.length + parsed.badId.length),
    noauto: String(noAuto),
    fail: String(failed),
    left: String(left),
  });
}
