/**
 * 문지기 — 로그인 안 한 사람을 로그인 화면으로 보냅니다.
 *
 * 【2026-08-09 대표님 결정】
 * "비상업적으로 친구들한테만 회원 형식으로 공유하려고 하는 거야."
 *
 * 이 파일이 하는 일은 두 가지입니다.
 *
 *   1. 로그인 표(쿠키)를 갱신합니다.
 *      Supabase 로그인은 일정 시간이 지나면 만료되는데, 여기서 조용히
 *      새로 받아 둡니다. 안 하면 쓰다가 갑자기 튕깁니다.
 *
 *   2. 회원이 아니면 /login 으로 보냅니다.
 *
 * ⚠️ 이것만으로는 절반입니다.
 *    공개용 열쇠는 브라우저 안에 들어 있어서, 사이트를 거치지 않고
 *    데이터베이스에 직접 물어볼 수 있습니다. 그 길은 db/auth.sql 이
 *    막습니다. 둘 다 있어야 잠긴 것입니다.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 로그인 없이 열 수 있는 곳 */
const PUBLIC_PATHS = ["/login", "/auth"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 접속 정보가 없으면 로그인 여부를 판단할 방법이 없습니다.
  // 이때 통과시키면 '설정을 빠뜨렸을 때 사이트가 통째로 열리는' 사고가
  // 납니다. 그래서 안내 화면(/login)으로 보냅니다.
  if (!url || !anonKey) {
    return isPublic(request.nextUrl.pathname)
      ? response
      : NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // ⚠️ getSession() 이 아니라 getUser() 를 씁니다.
  //    getSession() 은 쿠키에 적힌 내용을 그대로 믿습니다. 쿠키는 사람이
  //    고칠 수 있으므로, 그걸 믿으면 로그인한 척을 할 수 있습니다.
  //    getUser() 는 Supabase 에 다시 물어봅니다.
  const { data } = await supabase.auth.getUser();

  if (!data.user && !isPublic(request.nextUrl.pathname)) {
    const to = new URL("/login", request.url);
    // 로그인한 뒤 원래 보려던 화면으로 돌려보내기 위해 적어 둡니다
    const from = request.nextUrl.pathname + request.nextUrl.search;
    if (from && from !== "/") to.searchParams.set("next", from);
    return NextResponse.redirect(to);
  }

  // 이미 로그인했는데 로그인 화면에 오면 첫 화면으로 보냅니다
  if (data.user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

export const config = {
  /**
   * 문지기를 세울 곳.
   *
   * 그림·글꼴 같은 것까지 일일이 확인하면 느려지기만 하므로 뺍니다.
   * ⚠️ 화면 주소는 절대 빼지 마세요. 하나 빠지면 그 화면만 누구나 볼 수
   *    있게 됩니다.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
