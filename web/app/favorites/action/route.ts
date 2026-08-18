/**
 * 즐겨찾기 담기 / 빼기 / 안내문 확인.
 *
 * 【2026-08-18 대표님 요청으로 만들었습니다】
 *
 * 🚨 여기서는 '로그인했는지' 만 봅니다.
 *    "내 것만" 은 데이터베이스(db/favorites.sql)가 지킵니다. 화면 코드는
 *    조건 하나가 빠질 수 있어서 진짜 자물쇠로 쓰지 않습니다.
 *    (공유 링크 만들기와 같은 원칙입니다)
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole } from "@/lib/supabase";
import {
  addFavorite,
  markNoticed,
  removeFavorite,
  removeGone,
} from "@/lib/favorites";

export async function POST(request: NextRequest) {
  const form = await request.formData();

  // 누른 화면으로 되돌아갑니다 (도서 상세에서 눌렀으면 그 도서로).
  const rawBack = String(form.get("back") ?? "/favorites");
  // ⚠️ 남이 보낸 주소로 튕겨 보내지 않도록 우리 사이트 안쪽만 받습니다.
  const back = rawBack.startsWith("/") && !rawBack.startsWith("//")
    ? rawBack
    : "/favorites";
  const to = (msg: string) => {
    const url = new URL(back, request.url);
    url.searchParams.set("fav", msg);
    return NextResponse.redirect(url, { status: 303 });
  };

  if ((await currentRole()) === null) return to("nologin");

  const what = String(form.get("do") ?? "");

  // ---- 안내문 확인 ----
  if (what === "noticed") {
    return to((await markNoticed()) ? "noticed" : "failed");
  }

  // ---- 사라진 책 줄을 목록에서 빼기 ----
  if (what === "forget") {
    const id = Number(form.get("id"));
    if (!Number.isInteger(id) || id <= 0) return to("badinput");
    return to((await removeGone(id)) ? "removed" : "failed");
  }

  const bookId = Number(form.get("book"));
  if (!Number.isInteger(bookId) || bookId <= 0) return to("badinput");

  // ---- 빼기 ----
  if (what === "remove") {
    return to((await removeFavorite(bookId)) ? "removed" : "failed");
  }

  // ---- 담기 ----
  if (what === "add") {
    const res = await addFavorite({
      id: bookId,
      // 책이 지워진 뒤에도 무엇이었는지 알 수 있게 함께 적어 둡니다.
      title: String(form.get("title") ?? "").slice(0, 300),
      author: String(form.get("author") ?? "").slice(0, 200) || null,
      publisher: String(form.get("publisher") ?? "").slice(0, 200) || null,
    });
    if (res.needsSql) return to("needsql");
    return to(res.ok ? "added" : "failed");
  }

  return to("badinput");
}
