import Link from "next/link";
import { dayLabel } from "@/lib/format";
import type { Staleness } from "@/lib/stale";

/**
 * "며칠째 새 자료가 안 들어왔습니다" 띠.
 *
 * 【왜 사이트 안에 두나요? — 2026-08-09】
 * 자동 수집이 멈추는 방법 중에 **아무 신호도 안 나는 것**이 하나 있습니다.
 * GitHub 은 저장소에 오래 아무 변경이 없으면 예약 작업을 스스로 끕니다.
 * 그러면 실패가 아니라 **아예 안 도는** 상태라, 빨간 X 도 메일도 없습니다.
 * 그 구멍은 GitHub 바깥에서만 막을 수 있습니다.
 *
 * 【2026-08-18 대표님 지적으로 둘로 나눴습니다】
 *   "일반 방문자들이 몰라도 되는 영역까지 너무 많이 작성되어 있어."
 *
 * 예전에는 **모든 방문자에게** GitHub 조작 순서와 "저(클로드)에게
 * 알려주세요" 까지 보였습니다. 방문자는 그 버튼을 누를 수도 없습니다.
 *
 *   · 방문자 — 자료가 늦다는 사실 한 줄
 *   · 관리자 — 거기에 무엇을 누르면 되는지 한 줄
 *
 * 자세한 대처법(빨간 ✕ / Enable workflow / 기록 없음)은 운영 문서로
 * 옮겼습니다. 화면에 매뉴얼을 펼쳐 놓지 않습니다.
 */

const ACTIONS_URL =
  "https://github.com/choimog/apple/actions/workflows/daily-crawl.yml";

export default function StaleWarning({
  info,
  latest,
  isAdmin = false,
}: {
  info: Staleness;
  latest: string;
  isAdmin?: boolean;
}) {
  if (info.level === "ok") return null;

  const bad = info.level === "bad";

  return (
    <div
      role="alert"
      className={`mb-5 rounded-2xl border px-4 py-3 sm:px-5 ${
        bad
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
      }`}
    >
      <p
        className={`text-sm font-semibold ${
          bad
            ? "text-red-800 dark:text-red-300"
            : "text-amber-900 dark:text-amber-300"
        }`}
      >
        {info.days}일째 새 자료가 들어오지 않았습니다
      </p>
      <p
        className={`mt-0.5 text-xs ${
          bad
            ? "text-red-700 dark:text-red-400"
            : "text-amber-800 dark:text-amber-400"
        }`}
      >
        마지막 자료는 <strong>{dayLabel(latest)}</strong> 것입니다.
        {!bad && " 내일 아침에 다시 시도합니다."}
      </p>

      {/* 🚨 누를 수 있는 사람에게만 보여줍니다 */}
      {isAdmin && (
        <p
          className={`mt-2 text-xs ${
            bad
              ? "text-red-700 dark:text-red-400"
              : "text-amber-800 dark:text-amber-400"
          }`}
        >
          <Link
            href={ACTIONS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            [매일 수집] 열기 ↗
          </Link>
          {bad
            ? " — 빨간 ✕ 이거나 [Enable workflow] 버튼이 보이면 눌러 주세요."
            : " — 지금 바로 받고 싶으시면 [Run workflow]."}
        </p>
      )}
    </div>
  );
}
