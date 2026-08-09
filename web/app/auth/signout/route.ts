/**
 * 로그아웃.
 *
 * 【왜 화면이 아니라 이런 주소인가요?】
 * 로그아웃은 '보는 것' 이 아니라 '바꾸는 것' 입니다. 그래서 링크가 아니라
 * 버튼(POST)으로만 되게 해 두었습니다. 링크로 만들면 남이 보낸 주소를
 * 눌렀을 때 나도 모르게 로그아웃될 수 있습니다.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303, // 버튼으로 왔으므로 돌아갈 때는 보통 화면 열기로 바꿉니다
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

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

  await supabase.auth.signOut();
  return response;
}
