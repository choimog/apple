/**
 * 공유 링크 만들기 / 켜고 끄기.
 *
 * 여기서도 관리자인지 한 번 보고, 데이터베이스에서 또 봅니다.
 * 화면 코드는 실수로 빠질 수 있고, 그러면 아무나 링크를 만들게 됩니다.
 * 데이터베이스 쪽(db/share.sql 의 is_admin 확인)이 진짜 자물쇠입니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole } from "@/lib/supabase";
import { createShareLink, setShareLink } from "@/lib/share";

export async function POST(request: NextRequest) {
  const form = await request.formData();

  const to = (query: string) =>
    NextResponse.redirect(new URL(`/share?${query}`, request.url), { status: 303 });

  const role = await currentRole();
  if (role !== "admin") return to("msg=notadmin");

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
    // 빈 값이면 기한 없음. 이상한 값이 오면 가장 짧은 쪽(안전한 쪽)으로.
    const days = rawDays === "" ? null : Number(rawDays);
    const safeDays =
      days === null ? null : Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 7;

    const res = await createShareLink(categoryId, label, safeDays);
    if (res.error || !res.token) {
      return to(res.error?.includes("db/share.sql") ? "msg=needsql" : "msg=failed");
    }
    // 주소는 이때 한 번만 크게 보여줍니다 (목록에도 남습니다)
    return to(`new=${encodeURIComponent(res.token)}`);
  }

  return to("msg=badinput");
}
