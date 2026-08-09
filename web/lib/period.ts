/**
 * 집계 기간(일간/주간) 표시에 쓰는 값들.
 *
 * 【왜 queries.ts 에서 떼어냈나요? — 2026-08-09】
 * queries.ts 는 데이터베이스에 붙는 파일이라 '서버에서만 되는 파일' 입니다.
 * 그런데 화면(브라우저) 쪽 부품도 '일간/주간' 같은 글자는 써야 합니다.
 * 한 파일에 같이 두면 브라우저 쪽 부품이 데이터베이스 연결까지 끌고
 * 들어가서 빌드가 통째로 실패합니다. 실제로 그랬습니다.
 *
 * 그래서 '글자만 있는 것' 은 여기에 둡니다. 이 파일은 아무 데서나 씁니다.
 */

/** 집계 기간. DB 의 categories.kind 값과 맞춥니다. */
export type Period = "daily" | "weekly";

/**
 * 이 분야가 '최근 7일 누적(주간)' 인지.
 *
 * 일간과 주간은 분야 이름이 똑같아서(둘 다 '전체'), 표시로 구분하지 않으면
 * 화면에서 어느 쪽을 보고 있는지 알 수 없습니다.
 */
export function isWeekly(c: { kind: string }): boolean {
  return c.kind === "weekly";
}

export function periodOf(c: { kind: string }): Period {
  return c.kind === "weekly" ? "weekly" : "daily";
}

export const PERIOD_LABEL: Record<Period, string> = {
  daily: "일간",
  weekly: "주간",
};

/** 그 기간이 무슨 뜻인지 한 줄 설명 */
export const PERIOD_HELP: Record<Period, string> = {
  daily: "어제 하루 판매 순위",
  weekly: "최근 7일 누적 판매 순위",
};
