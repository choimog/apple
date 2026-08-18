import type { Metadata } from "next";
import { configError } from "@/lib/supabase";

export const metadata: Metadata = { title: "로그인" };

/**
 * 로그인 화면.
 *
 * 이 화면만 로그인 없이 열립니다 (middleware.ts 의 PUBLIC_PATHS).
 *
 * 【가입 칸이 없는 이유】
 * 가입 칸을 두면 주소를 아는 누구나 회원이 될 수 있습니다. 그러면
 * 회원제가 아니게 됩니다. 계정은 대표님이 Supabase 화면에서 직접
 * 만들어 주십니다 (docs/login-setup.md).
 *
 * 【이메일+비밀번호인 이유】
 * '메일로 링크 받아 로그인' 이 더 편하지만, 무료 요금제는 보낼 수 있는
 * 메일이 시간당 몇 통으로 묶여 있습니다. 친구 몇 분이 같은 시간에
 * 들어오면 뒤에 오신 분은 메일을 못 받고 못 들어옵니다.
 * 돈을 쓰지 않기로 했으므로 메일을 아예 안 쓰는 방식으로 갑니다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; detail?: string }>;
}) {
  const { next, error, detail } = await searchParams;

  // 주소를 그대로 믿지 않습니다. 우리 사이트 안의 주소만 받습니다.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const message = error ? errorText(error, detail) : null;

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-xl font-bold tracking-[-0.01em]">
        <span aria-hidden>📚</span> 베스트셀러 트래커
      </h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        회원만 볼 수 있습니다. 계정을 받으신 이메일로 로그인해 주세요.
      </p>

      {configError ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
        >
          {configError}
        </p>
      ) : (
        <form action="/auth/login" method="post" className="mt-5 space-y-3">
          <input type="hidden" name="next" value={safeNext} />

          <div>
            <label htmlFor="email" className="mb-1 block text-sm text-ink-soft">
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink-faint"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm text-ink-soft">
              비밀번호
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-ink-faint"
            />
          </div>

          {message && (
            <p
              role="alert"
              className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            className="w-full rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-accent-ink"
          >
            로그인
          </button>
        </form>
      )}

      <p className="mt-6 text-xs text-ink-faint">
        계정이 없으시면 운영자에게 말씀해 주세요.
      </p>
    </div>
  );
}

/** 영어 오류를 사람 말로. 모르는 것은 감추지 않고 그대로 보여줍니다. */
function errorText(code: string, detail?: string): string {
  switch (code) {
    case "wrong":
      return "이메일이나 비밀번호가 맞지 않습니다.";
    case "empty":
      return "이메일과 비밀번호를 모두 적어 주세요.";
    case "unconfirmed":
      return "계정이 아직 확인되지 않았습니다. 운영자에게 말씀해 주세요.";
    case "toomany":
      return "너무 여러 번 시도했습니다. 잠시 뒤에 다시 해주세요.";
    case "config":
      return "데이터베이스 접속 정보가 설정되지 않았습니다.";
    default:
      return detail ? `로그인하지 못했습니다: ${detail}` : "로그인하지 못했습니다.";
  }
}
