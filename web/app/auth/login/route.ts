/**
 * 로그인 처리.
 *
 * 【왜 화면(브라우저)에서 안 하고 서버에서 하나요? — 2026-08-09】
 * 처음에는 브라우저에서 Supabase 에 직접 로그인하게 만들었습니다.
 * 흔한 방식이지만 두 가지가 걸렸습니다.
 *
 *   1. 자바스크립트가 막힌 환경에서는 로그인 자체가 안 됩니다.
 *   2. **자동 검사를 할 수가 없습니다.** 로그인 표가 브라우저 안에서만
 *      만들어지므로, 검사 프로그램이 회원인 척하고 화면을 열어볼 방법이
 *      없습니다. 그러면 회원 전용으로 바꾼 뒤로는 어떤 화면이 깨져도
 *      배포하고 나서야 알게 됩니다.
 *
 * 그래서 평범한 양식 전송(POST)으로 바꿨습니다. 서버가 로그인하고
 * 쿠키를 붙여 돌려줍니다.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** 로그인한 뒤 돌아갈 곳. 우리 사이트 안이어야 합니다. */
function safeNext(value: FormDataEntryValue | null): string {
  const s = typeof value === "string" ? value : "";
  // '//남의사이트' 는 우리 주소가 아닙니다. 로그인 화면을 거쳐
  // 딴 데로 보내는 수법을 막습니다.
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));

  const back = (code: string) => {
    const to = new URL("/login", request.url);
    to.searchParams.set("error", code);
    if (next !== "/") to.searchParams.set("next", next);
    return NextResponse.redirect(to, { status: 303 });
  };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return back("config");
  if (!email || !password) return back("empty");

  const response = NextResponse.redirect(new URL(next, request.url), {
    status: 303,
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const m = error.message.toLowerCase();
    if (m.includes("invalid login credentials")) return back("wrong");
    if (m.includes("email not confirmed")) return back("unconfirmed");
    if (m.includes("rate limit") || m.includes("too many")) return back("toomany");
    // 모르는 오류는 감추지 않습니다. 감추면 물어볼 수도 없습니다.
    const to = new URL("/login", request.url);
    to.searchParams.set("error", "other");
    to.searchParams.set("detail", error.message.slice(0, 200));
    if (next !== "/") to.searchParams.set("next", next);
    return NextResponse.redirect(to, { status: 303 });
  }

  return response;
}
