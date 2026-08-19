/**
 * 종합 순위의 **등락**을 계산하는 규칙 — 여기 한 곳에만 둡니다.
 *
 * 【2026-08-19 대표님 요청】
 *   "종합, 웰컴에도 평균을 낸 수치로 계산된 순위에 등락을 표기해줬으면 좋겠어."
 *
 * 견주는 것은 **평균값이 아니라 그 평균으로 매긴 등수**입니다.
 * 평균 3.7 → 3.3 은 읽어도 뜻을 모릅니다. 5위 → 3위(▲2)는 바로 읽힙니다.
 * 서점별 화면의 등락과 뜻이 같아져서 헷갈리지도 않습니다.
 *
 * ⚠️ 이 파일에는 **데이터베이스도 화면도 없습니다.** 순수한 계산만 있습니다.
 *    그래야 인터넷 없이 시험할 수 있습니다 (scripts/test-rank-change.mjs).
 */

/**
 * 종합 순위 줄 세우기 — **여기 한 곳에만 둡니다.**
 *
 * 🚨 【왜 도서 번호까지 보나요 — 2026-08-19】
 *   평균은 정수들의 평균이라 **같은 값이 자주 나옵니다.**
 *   (1·3·5 → 3.0 과 2·3·4 → 3.0)
 *   평균도 서점 수도 같으면 그다음 순서는 데이터베이스 마음입니다.
 *   그러면 자료가 하나도 안 바뀐 날에도 두 책이 자리를 바꿔서
 *   등락에 **가짜 ▲1 ▼1** 이 찍힙니다. 그건 없는 것보다 나쁩니다.
 *   그래서 마지막에 도서 번호로 못 박습니다 — 언제 봐도 같은 순서입니다.
 */
export function sortCombined<
  T extends { avgRank: number | null; storeCount: number; bookId: number },
>(rows: T[]): T[] {
  return [...rows].sort(
    (x, y) =>
      (x.avgRank ?? Infinity) - (y.avgRank ?? Infinity) ||
      y.storeCount - x.storeCount ||
      x.bookId - y.bookId
  );
}

/** 한 줄의 등락 결과 */
export type RankChangeResult = {
  /**
   * 오른 계단 수. 3위 → 1위 면 +2.
   * **null 은 '비교할 수 없음'** 입니다. 0(제자리)과 뜻이 다릅니다.
   */
  change: number | null;
  /** 지난 목록에는 없던 책 */
  isNew: boolean;
};

/**
 * 오늘 목록과 지난 목록을 견줘 줄마다 등락을 냅니다.
 *
 * @param todayIds  오늘 목록의 도서 번호 (이미 줄 세운 차례대로)
 * @param prevIds   지난 목록의 도서 번호 (이미 줄 세운 차례대로)
 * @param truncated 지난 목록이 상한에 걸려 **잘렸는가**
 *
 * 🚨 【잘린 목록으로 'NEW' 라고 하지 않습니다】
 *   데이터베이스 함수는 한 번에 500줄까지만 줍니다. 어제 501위였던 책을
 *   '어제 없던 책' 이라고 하면 거짓말입니다. 잘렸으면 '–' 로 둡니다.
 *   모르는 것을 아는 척하지 않습니다.
 */
export function rankChanges(
  todayIds: number[],
  prevIds: number[],
  truncated: boolean
): RankChangeResult[] {
  const at = new Map<number, number>();
  // 같은 책이 두 번 오면 **더 높은 자리**를 씁니다 (먼저 온 것이 더 높습니다)
  prevIds.forEach((id, i) => {
    if (!at.has(id)) at.set(id, i + 1);
  });

  return todayIds.map((id, i) => {
    const was = at.get(id);
    if (was !== undefined) return { change: was - (i + 1), isNew: false };
    // 지난 목록에 없음 — 잘린 목록이면 '없다' 고 단정할 수 없습니다
    return { change: null, isNew: !truncated };
  });
}

/** 등락을 무엇과 견줬는지 (화면 머리에 한 줄로 적기 위한 값) */
export type ChangeBasis = {
  /** 비교 기준이 된 지난 수집일. 못 하면 null */
  prevDate: string | null;
  /** 비교를 못 한 이유 (null 이면 정상 비교) */
  blocked:
    | null
    /** 이 조건에 이전 수집일이 아예 없음 (첫날) */
    | "no-prev"
    /** 그날은 자료가 있는 서점이 달라서 평균끼리 견줄 수 없음 */
    | "stores-differ"
    /** 데이터베이스 계산 기능(db/perf.sql)이 없어 계산을 안 함 */
    | "slow";
  /**
   * 지난 목록이 **잘렸는가**(500줄 상한).
   * 잘렸으면 '어제 목록에 없다' 를 '새로 들어왔다' 라고 단정할 수 없습니다.
   */
  truncated: boolean;
};

/**
 * 등락을 무엇과 견줬는지 한 줄로 적어 주는 말.
 *
 * 🚨 【왜 필요한가요 — 2026-08-19】
 *   비교를 못 한 날은 100줄이 전부 '–' 가 됩니다. 이유를 안 적으면
 *   대표님은 "등락이 고장났나" 하고 물어보실 수밖에 없습니다.
 *   **낮게 나오는 경고는 안 나오는 경고와 같습니다** — 이유를 적습니다.
 *
 * @param label 날짜를 사람이 읽는 모양으로 바꾸는 함수 (lib/format 의 dayLabel)
 */
export function changeNote(
  basis: ChangeBasis | null,
  label: (iso: string) => string
): string | null {
  if (!basis) return null;
  switch (basis.blocked) {
    case "no-prev":
      return "등락 없음 — 이 조건으로는 이전 수집 기록이 없습니다";
    case "stores-differ":
      return basis.prevDate
        ? `등락 없음 — ${label(basis.prevDate)}은 자료가 있는 서점이 달라 평균끼리 견줄 수 없습니다`
        : "등락 없음 — 지난 수집일은 자료가 있는 서점이 달랐습니다";
    case "slow":
      return "등락 없음 — 데이터베이스 속도 개선을 켜야 계산합니다";
    default:
      break;
  }
  if (!basis.prevDate) return null;
  const base = `등락은 ${label(basis.prevDate)} 대비`;
  // 지난 목록이 잘렸으면 'NEW' 를 못 붙입니다. 그 사실도 적어 둡니다.
  return basis.truncated ? `${base} (지난 500위까지만 견줌)` : base;
}
