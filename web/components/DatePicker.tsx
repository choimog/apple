"use client";

/**
 * 날짜 고르기.
 *
 * 【왜 버튼을 그만뒀나요? — 2026-08-08 대표님 지적】
 * "날짜가 저런 버튼형식으로 표기되면, 앞으로 무한히 늘어날 때 문제가 될 것."
 * 맞습니다. 하루에 하나씩 늘어나므로 1년이면 365개가 됩니다.
 * 그래서 목록에서 고르는 방식으로 바꾸고, 자주 쓰는 '앞/뒤 날짜' 는
 * 화살표 버튼으로 한 번에 갈 수 있게 뒀습니다.
 *
 * 목록에는 실제로 수집된 날짜만 들어갑니다. 없는 날짜는 고를 수 없습니다.
 */

import { useRouter } from "next/navigation";

/**
 * ⚠️ 주소를 만드는 '함수' 를 받으면 안 됩니다.
 * 이 파일은 브라우저에서 도는 조각(client component)이라, 서버 화면에서
 * 함수를 건네줄 수 없습니다. 실제로 그렇게 만들었다가 모든 화면이
 * 오류로 떴습니다 (2026-08-08). 그래서 '주소 + 값들' 만 받아서
 * 여기서 직접 주소를 만듭니다.
 */
export default function DatePicker({
  dates,
  value,
  basePath,
  query = {},
  label = "날짜",
}: {
  /** 고를 수 있는 날짜 (최신순) */
  dates: string[];
  value: string;
  /** 예: "/best" */
  basePath: string;
  /** 날짜 말고 유지해야 할 값들 (예: 분야·기간) */
  query?: Record<string, string>;
  label?: string;
}) {
  const router = useRouter();
  const i = dates.indexOf(value);

  const hrefFor = (date: string) => {
    const p = new URLSearchParams({ ...query, date });
    return `${basePath}?${p.toString()}`;
  };

  // dates 는 최신순이므로 '이전 날짜' 는 뒤쪽(i+1), '다음 날짜' 는 앞쪽(i-1)
  const older = i >= 0 && i + 1 < dates.length ? dates[i + 1] : null;
  const newer = i > 0 ? dates[i - 1] : null;

  const go = (d: string | null) => {
    if (d) router.push(hrefFor(d), { scroll: false });
  };

  const arrow =
    "grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft transition-colors enabled:hover:border-ink-faint enabled:hover:text-ink disabled:opacity-35";

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => go(older)}
        disabled={!older}
        aria-label="이전 수집일"
        title={older ? `${older} 로` : "더 이전 기록이 없습니다"}
        className={arrow}
      >
        ‹
      </button>

      <select
        value={value}
        onChange={(e) => go(e.target.value)}
        aria-label={label}
        className="tnum h-9 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink"
      >
        {dates.map((d, k) => (
          <option key={d} value={d}>
            {d}
            {k === 0 ? " (최신)" : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => go(newer)}
        disabled={!newer}
        aria-label="다음 수집일"
        title={newer ? `${newer} 로` : "가장 최근 기록입니다"}
        className={arrow}
      >
        ›
      </button>
    </div>
  );
}
