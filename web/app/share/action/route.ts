/**
 * 공유 링크 만들기 / 켜고 끄기.
 *
 * 【2026-08-09 부터 회원도 만들 수 있습니다】
 * 그래서 여기서는 '로그인했는지' 만 봅니다.
 * 개수 제한(20개)·기한 제한(90일)·남의 링크 못 끄기는 전부
 * **데이터베이스**(db/share-open.sql)가 지킵니다.
 * 화면 코드는 조건 하나가 빠질 수 있어서 진짜 자물쇠로 쓰지 않습니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole } from "@/lib/supabase";
import { createShareLink, setShareLink } from "@/lib/share";

export async function POST(request: NextRequest) {
  const form = await request.formData();

  const to = (query: string) =>
    NextResponse.redirect(new URL(`/share?${query}`, request.url), { status: 303 });

  // 로그인만 확인합니다. 나머지 제한은 데이터베이스가 지킵니다.
  const role = await currentRole();
  if (role === null) return to("msg=notadmin");

  const what = String(form.get("do") ?? "");

  // ---- 켜고 끄기 ----
  if (what === "toggle") {
    const token = String(form.get("token") ?? "");
    const enabled = String(form.get("enabled") ?? "") === "true";
    if (!token) return to("msg=badinput");

    const res = await setShareLink(token, enabled);
    if (!res.ok) {
      return to(res.error?.includes("db/share.sql") ? "msg=needsql" : "msg=failed");
    }
    return to(enabled ? "msg=on" : "msg=off");
  }

  // ---- 만들기 ----
  if (what === "create") {
    const categoryId = Number(form.get("category"));
    if (!Number.isInteger(categoryId) || categoryId <= 0) return to("msg=badinput");

    const label = String(form.get("label") ?? "").trim().slice(0, 60);
    const rawDays = String(form.get("days") ?? "");
    // 빈 값이면 기한 없음(관리자만 의미 있음).
    // 이상한 값이 오면 가장 짧은 쪽(안전한 쪽)으로 보냅니다.
    //
    // ⚠️ 회원에게는 이 숫자가 '시간' 으로 읽힙니다 (db/share-open.sql).
    //    여기서 아무리 큰 값을 보내도 데이터베이스가 3시간으로 자릅니다.
    //    진짜 한도는 화면이 아니라 데이터베이스에 있습니다.
    const days = rawDays === "" ? null : Number(rawDays);
    const safeDays =
      days === null ? null : Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 1;

    /*
      【2026-08-10 대표님 요청】 특정 일자 고정.

      ⚠️ 형식이 조금이라도 어긋나면 데이터베이스가 날짜로 못 읽고
         **오류를 냅니다.** 그래서 여기서 먼저 걸러냅니다.
         · YYYY-MM-DD 모양인가
         · 진짜 있는 날짜인가 (2026-02-31 같은 것 거르기)
         · 미래가 아닌가 (아직 없는 순위는 빈 화면이 됩니다)
    */
    const rawDate = String(form.get("fixed") ?? "").trim();
    let fixedDate: string | null = null;
    if (rawDate !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return to("msg=baddate");
      const d = new Date(`${rawDate}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== rawDate) {
        return to("msg=baddate");
      }
      // 한국 날짜로 오늘보다 뒤면 거절합니다
      const todayKst = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
      }).format(new Date());
      if (rawDate > todayKst) return to("msg=futuredate");
      fixedDate = rawDate;
    }

    const res = await createShareLink(categoryId, label, safeDays, fixedDate);
    if (res.error || !res.token) {
      return to(res.error?.includes("db/share.sql") ? "msg=needsql" : "msg=failed");
    }
    // 주소는 이때 한 번만 크게 보여줍니다 (목록에도 남습니다)
    return to(`new=${encodeURIComponent(res.token)}`);
  }

  return to("msg=badinput");
}
