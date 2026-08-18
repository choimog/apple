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
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
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
  compact = false,
}: {
  value: number | null;
  /** 이 서점이 판매지수를 제공하는가 (교보는 false) */
  storeProvides?: boolean;
  size?: "sm" | "md";
  /**
   * 좁은 칸(목록 안의 서점 상자)인가.
   *
   * 🚨 【2026-08-18 대표님 지적으로 생겼습니다】
   * "판매지수 미제공" 은 여덟 글자라 좁은 칸에서 두 줄로 접히거나
   * 삐져나갔습니다. 좁은 곳에서는 '미제공' 으로 줄이고, 무슨 뜻인지는
   * 마우스를 올렸을 때 나오는 설명에 그대로 둡니다.
   * (뜻을 지우는 게 아니라 자리를 아끼는 것입니다)
   */
  compact?: boolean;
}) {
  if (!storeProvides) {
    return (
      <span
        className="text-xs text-ink-faint"
        title="교보문고는 판매지수를 공개하지 않습니다. 추정치를 넣지 않습니다."
      >
        {compact ? "미제공" : "판매지수 미제공"}
      </span>
    );
  }
  if (value === null) {
    return (
      <span className="text-xs text-ink-faint" title="이 날짜에 값이 없습니다">
        –
      </span>
    );
  }
  return (
    <div className="w-full">
      {/*
        ⚠️ 숫자에는 띄어쓸 자리가 없어서 **줄바꿈이 안 됩니다.**
           좁은 칸에서 `12,845,300` 같은 값이 그대로 삐져나갑니다.
           (2026-08-18 에 320px 화면에서 7px 넘치는 것을 재서 확인)
           좁은 칸에서만 한 단계 작게 씁니다. 값은 그대로 다 보여줍니다 —
           잘라내면 자릿수가 달라져서 딴 숫자가 됩니다.
      */}
      <div
        className={
          compact
            ? "text-xs font-semibold tnum text-ink"
            : size === "sm"
              ? "text-sm font-semibold tnum text-ink"
              : "text-base font-bold tnum text-ink"
        }
      >
        {value.toLocaleString()}
      </div>
      <SalesBar value={value} />
    </div>
  );
}
