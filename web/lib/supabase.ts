/**
 * 데이터베이스 연결.
 *
 * 【비밀키 원칙 — 절대 어기지 않습니다】
 * 여기서는 'anon key'(공개용 열쇠)만 씁니다.
 * 이 열쇠는 브라우저에 노출돼도 되는 값입니다.
 *
 * 'service_role key'(관리자 열쇠)는 이 폴더에 절대 두지 않습니다.
 * 그건 GitHub Actions 의 수집 작업에서만 쓰고, Secrets 에만 넣습니다.
 *
 * 값은 Vercel 의 Environment Variables 에 등록합니다. 코드에 값이 없습니다.
 *
 * ---------------------------------------------------------------------------
 * 【2026-08-09 회원 전용으로 바꾸면서 구조가 바뀌었습니다】
 *
 * 대표님 결정: "친구들한테만 회원 형식으로 공유".
 *
 * 그러려면 문을 두 개 잠가야 합니다. 하나만 잠그면 잠근 척이 됩니다.
 *
 *   문 1  사이트          → middleware.ts 가 로그인 안 한 사람을 돌려보냅니다
 *   문 2  데이터베이스     → db/auth.sql 이 로그인한 사람에게만 읽기를 줍니다
 *
 * 문 2 가 왜 필요한가: 공개용 열쇠는 브라우저 안에 그대로 들어 있습니다.
 * 주소창을 열 줄 아는 사람이면 그 열쇠로 데이터베이스에 직접 물어볼 수
 * 있습니다. 사이트만 막으면 그 길이 그대로 열려 있습니다.
 *
 * 그래서 이제는 **접속할 때마다 그 사람의 로그인 표(쿠키)를 함께 보냅니다.**
 * 예전처럼 열쇠 하나를 모두가 나눠 쓰지 않습니다.
 *
 * ⚠️ 그래서 이 파일은 더 이상 `supabase` 라는 '하나짜리 연결' 을 내보내지
 *    않습니다. 접속마다 새로 만들어야 합니다 — 안 그러면 A 님의 로그인
 *    상태가 B 님 화면에 섞일 수 있습니다.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 설정이 안 됐을 때 화면에 보여줄 안내문 (조용히 빈 화면을 띄우지 않습니다) */
export const configError =
  !url || !anonKey
    ? "데이터베이스 접속 정보가 설정되지 않았습니다. " +
      "Vercel → Settings → Environment Variables 에 " +
      "NEXT_PUBLIC_SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 등록하세요."
    : null;

/**
 * 이번 접속에 쓸 데이터베이스 연결.
 *
 * 쓰는 법: `await db().from("books").select(...)`
 *
 * ⚠️ 결과를 파일 맨 위 변수에 담아 두고 재사용하면 안 됩니다.
 *    한 사람의 로그인 상태가 다른 사람 화면에 넘어갈 수 있습니다.
 *    부를 때마다 새로 만드는 것이 이 함수의 요점입니다.
 *
 * 쿠키는 부를 때가 아니라 '실제로 필요할 때' 읽습니다. 그래야 이 함수를
 * 평범한 함수로 둘 수 있고, 쓰는 쪽 코드가 await 로 두 겹이 되지 않습니다.
 */
export function db() {
  return createServerClient(url ?? "http://localhost", anonKey ?? "missing", {
    cookies: {
      getAll: async () => (await cookies()).getAll(),
      setAll: async (list) => {
        try {
          const jar = await cookies();
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // 화면(서버 컴포넌트)에서는 쿠키를 못 씁니다.
          // 로그인 표 갱신은 middleware.ts 가 맡으므로 여기서는 넘어갑니다.
        }
      },
    },
  });
}

/** 지금 로그인한 사람. 로그인 안 했으면 null. */
export async function currentUser() {
  const { data } = await db().auth.getUser();
  return data.user ?? null;
}

/** 지금 로그인한 사람의 권한. 'admin' | 'viewer' | null(로그인 안 함) */
export async function currentRole(): Promise<"admin" | "viewer" | null> {
  const supabase = db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  // 계정은 있는데 권한 줄이 없으면 가장 낮은 권한으로 봅니다.
  // 여기서 admin 으로 봐 버리면 권한이 조용히 새어 나갑니다.
  return data?.role === "admin" ? "admin" : "viewer";
}

/*
 * 서점 이름·색은 lib/stores.ts 로 옮겼습니다 (2026-08-09).
 *
 * 이 파일이 next/headers 를 쓰게 되면서 '서버에서만 되는 파일' 이
 * 됐는데, 서점 이름은 화면(브라우저) 쪽 부품에서도 씁니다.
 * 같이 두면 빌드가 통째로 실패합니다. 실제로 그랬습니다.
 */
