/**
 * 판매지수 표시.
 *
 * 【왜 크게 보여주나요? — 2026-08-07 대표님 요청】
 * "순위만큼 판매지수도 중요하다."
 * 순위는 1위와 2위의 차이를 안 보여줍니다. 1위가 2위의 10배일 수도,
 * 종이 한 장 차이일 수도 있습니다. 그 차이는 판매지수에만 나옵니다.
 *
 * 【서점끼리 더하거나 평균 내지 않습니다】
 * 예스24 '판매지수' 와 알라딘 '세일즈포인트' 는 계산식이 다른 별개의 값입니다.
 * 섞으면 아무 뜻도 없는 숫자가 되므로 항상 서점별로 따로 보여줍니다.
 * 교보문고는 판매지수를 아예 공개하지 않습니다. 추정해서 채우지 않습니다.
 */

/** 막대 길이를 정하는 기준값. 이 값이면 막대가 꽉 찹니다. */
const FULL_BAR = 500_000;

export function SalesBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.round((value / FULL_BAR) * 100));
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full bg-slate-400"
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );
}

export default function SalesPoint({
  value,
  storeProvides = true,
  size = "md",
}: {
  value: number | null;
  /** 이 서점이 판매지수를 제공하는가 (교보는 false) */
  storeProvides?: boolean;
  size?: "sm" | "md";
}) {
  if (!storeProvides) {
    return (
      <span
        className="text-xs text-slate-400"
        title="교보문고는 판매지수를 공개하지 않습니다. 추정치를 넣지 않습니다."
      >
        판매지수 미제공
      </span>
    );
  }
  if (value === null) {
    return (
      <span className="text-xs text-slate-400" title="이 날짜에 값이 없습니다">
        –
      </span>
    );
  }
  return (
    <div className="w-full">
      <div
        className={
          size === "sm"
            ? "text-sm font-semibold tabular-nums text-slate-800"
            : "text-base font-bold tabular-nums text-slate-900"
        }
      >
        {value.toLocaleString()}
      </div>
      <SalesBar value={value} />
    </div>
  );
}
