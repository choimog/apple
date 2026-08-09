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
 * 【무엇을 하라고 적을지가 이 화면의 전부입니다】
 * "3일째 자료가 없습니다" 만 띄우면 대표님은 무엇을 해야 할지 모릅니다.
 * 그래서 **누를 곳과 순서**를 그대로 적어 둡니다.
 */

const ACTIONS_URL =
  "https://github.com/choimog/apple/actions/workflows/daily-crawl.yml";

export default function StaleWarning({
  info,
  latest,
}: {
  info: Staleness;
  latest: string;
}) {
  if (info.level === "ok") return null;

  const bad = info.level === "bad";

  return (
    <div
      role="alert"
      className={`mb-5 rounded-2xl border px-4 py-3.5 sm:px-5 ${
        bad
          ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
          : "border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
      }`}
    >
      <p
        className={`text-sm font-bold ${
          bad
            ? "text-red-800 dark:text-red-300"
            : "text-amber-900 dark:text-amber-300"
        }`}
      >
        {bad ? "🚨" : "⚠️"} {info.days}일째 새 자료가 들어오지 않았습니다
      </p>
      <p
        className={`mt-1 text-xs leading-relaxed ${
          bad
            ? "text-red-700 dark:text-red-400"
            : "text-amber-800 dark:text-amber-400"
        }`}
      >
        마지막으로 모은 자료는 <strong>{dayLabel(latest)}</strong> 것입니다.
        {!bad && " 오늘 아침에 자동으로 다시 시도합니다."}
      </p>

      {bad ? <WhatToDoBad /> : <WhatToDoWarn />}
    </div>
  );
}

/* ---------------------------------------------------------------- 2일째 */

function WhatToDoWarn() {
  return (
    <div className="mt-3 text-xs leading-relaxed text-amber-800 dark:text-amber-400">
      <p>
        <strong>하루치가 빈 것은 가끔 있는 일입니다.</strong> 서점 쪽이
        잠깐 느렸거나 수집이 한 번 걸러진 경우입니다. 그냥 두셔도 내일
        아침에 채워집니다.
      </p>
      <p className="mt-2">
        지금 바로 받고 싶으시면 아래에서 <strong>[Run workflow]</strong> 를
        누르세요. 1시간쯤 걸립니다.
      </p>
      <ActionButton tone="warn" />
    </div>
  );
}

/* -------------------------------------------------------------- 3일 이상 */

function WhatToDoBad() {
  return (
    <div className="mt-3 space-y-3 text-xs leading-relaxed text-red-700 dark:text-red-400">
      <p className="font-semibold">
        이틀 넘게 안 들어왔습니다. 대표님이 한 번 봐 주셔야 합니다.
      </p>

      <ActionButton tone="bad" />

      <div>
        <p className="font-semibold">그 화면에서 셋 중 하나가 보일 겁니다.</p>
        <ol className="mt-1.5 space-y-2">
          <li>
            <strong>㉮ 목록 맨 위에 빨간 ✕ 가 있다</strong>
            <br />
            수집이 실패하고 있습니다. 서점이 화면을 개편했을 가능성이 큽니다.
            <br />
            <span className="opacity-80">
              → 저(클로드)에게 알려주세요. 코드를 고쳐야 합니다.
            </span>
          </li>
          <li>
            <strong>
              ㉯ &ldquo;This workflow was disabled&rdquo; 같은 안내와{" "}
              <span className="whitespace-nowrap">[Enable workflow]</span>{" "}
              버튼이 있다
            </strong>
            <br />
            <strong>이게 가장 흔한 경우입니다.</strong> 저장소에 두 달쯤
            아무 변경이 없으면 GitHub 이 예약 작업을 스스로 끕니다.
            고장이 아닙니다.
            <br />
            <span className="opacity-80">
              → <strong>[Enable workflow]</strong> 를 누르시면 바로 살아납니다.
            </span>
          </li>
          <li>
            <strong>㉰ 최근 실행 기록이 아예 없다</strong>
            <br />
            ㉯ 와 같은 상황입니다. 위와 똑같이 하시면 됩니다.
            <br />
            <span className="opacity-80">
              → 버튼이 안 보이면 저에게 알려주세요.
            </span>
          </li>
        </ol>
      </div>

      <p>
        어느 쪽이든 마지막에 <strong>[Run workflow]</strong> 를 눌러 한 번
        돌려 주세요. 1시간쯤 뒤 이 띠가 사라지면 정상입니다.
      </p>

      <p className="opacity-80">
        지난 기록은{" "}
        <Link href="/status" className="underline">
          [수집 상태]
        </Link>{" "}
        화면에서 날짜별로 보실 수 있습니다.
      </p>
    </div>
  );
}

function ActionButton({ tone }: { tone: "warn" | "bad" }) {
  return (
    <a
      href={ACTIONS_URL}
      target="_blank"
      rel="noreferrer"
      className={`mt-2 inline-block rounded-lg border px-3 py-1.5 text-xs font-semibold ${
        tone === "bad"
          ? "border-red-400 text-red-800 hover:bg-red-500/10 dark:text-red-300"
          : "border-amber-400 text-amber-900 hover:bg-amber-500/10 dark:text-amber-300"
      }`}
    >
      GitHub 에서 [매일 수집] 열기 →
    </a>
  );
}
