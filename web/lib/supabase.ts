/**
 * 데이터베이스 연결.
 *
 * 【비밀키 원칙 — 절대 어기지 않습니다】
 * 여기서는 'anon key'(공개용 열쇠)만 씁니다.
 * 이 열쇠는 브라우저에 노출돼도 되는 값이며, 읽기만 가능합니다.
 *
 * 'service_role key'(관리자 열쇠)는 이 폴더에 절대 두지 않습니다.
 * 그건 GitHub Actions 의 수집 작업에서만 쓰고, Secrets 에만 넣습니다.
 *
 * 값은 Vercel 의 Environment Variables 에 등록합니다. 코드에 값이 없습니다.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 설정이 안 됐을 때 화면에 보여줄 안내문 (조용히 빈 화면을 띄우지 않습니다) */
export const configError =
  !url || !anonKey
    ? "데이터베이스 접속 정보가 설정되지 않았습니다. " +
      "Vercel → Settings → Environment Variables 에 " +
      "NEXT_PUBLIC_SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_ANON_KEY 를 등록하세요."
    : null;

export const supabase = createClient(url ?? "http://localhost", anonKey ?? "missing", {
  auth: { persistSession: false },
});

/** 서점 코드 → 화면에 보일 이름 */
export const STORE_NAME: Record<number, string> = {
  1: "교보문고",
  2: "예스24",
  3: "알라딘",
};

export const STORE_COLOR: Record<number, string> = {
  1: "bg-emerald-100 text-emerald-800",
  2: "bg-blue-100 text-blue-800",
  3: "bg-orange-100 text-orange-800",
};
