/**
 * 순위 등락 표시.
 *
 * 서점별 순위·종합 순위·웰컴 화면이 **모두 이 부품 하나**를 씁니다.
 * (화면마다 따로 그리면 색이나 화살표 방향이 조금씩 달라집니다)
 *
 * 【지키는 것】
 * 어제 데이터가 없으면 "-" 로 둡니다. 0이나 '변동없음'으로 지어내지 않습니다.
 */
export default function RankChange({
  change,
  isNew,
  size = "md",
  /** '–' 에 마우스를 올렸을 때 나올 설명 (왜 비교를 못 했는지) */
  unknownTitle = "비교할 이전 수집 기록이 없습니다",
}: {
  change: number | null;
  isNew: boolean;
  /** sm = 좁은 칸용 (종합·웰컴의 순위 아래) */
  size?: "sm" | "md";
  unknownTitle?: string;
}) {
  // 좁은 칸에서도 줄을 늘리지 않게 한 단계 작게 그립니다.
  // ⚠️ 색과 화살표는 그대로 둡니다. 작아지는 것은 글자 크기뿐입니다.
  const text = size === "sm" ? "text-[10px] leading-none" : "text-xs";

  if (isNew) {
    return (
      <span
        className={`inline-block rounded bg-purple-100 font-medium text-purple-700 dark:bg-purple-400/15 dark:text-purple-300 ${
          // ⚠️ 좁은 칸에서는 위아래 여백을 px 로 둡니다. 이 칸이 표지보다
          //    높아지는 순간 목록 전체의 줄 키가 커집니다 (실측 확인).
          size === "sm" ? "px-1 py-px text-[10px] leading-none" : "px-1.5 py-0.5 text-xs"
        }`}
        title="지난 수집일 순위에는 없던 책입니다"
      >
        NEW
      </span>
    );
  }
  if (change === null) {
    return (
      <span className={`${text} text-ink-faint`} title={unknownTitle}>
        –
      </span>
    );
  }
  if (change === 0) {
    return (
      <span className={`${text} text-ink-faint`} title="지난 수집일과 같은 자리">
        —
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      className={`${text} font-medium ${up ? "text-red-600 dark:text-red-400" : "text-blue-600 dark:text-blue-400"}`}
      title={up ? `${change}계단 상승` : `${-change}계단 하락`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(change)}
    </span>
  );
}

/*
  '등락은 8월 18일 (월) 대비' 같은 안내 문구는 lib/rank-change.ts 의
  changeNote 가 만듭니다. 여기(그리는 쪽)에 두지 않는 이유는 하나입니다 —
  거기에는 화면 코드가 없어서 인터넷 없이 시험할 수 있기 때문입니다.
*/
