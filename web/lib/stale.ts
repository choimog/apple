/**
 * "자료가 며칠째 안 들어오고 있는가" 판단.
 *
 * 【왜 이게 필요한가요? — 2026-08-09】
 * 자동 수집이 멈추는 방법 중에 **아무 신호도 안 나는 것**이 하나 있습니다.
 * GitHub 은 저장소에 오랫동안(약 60일) 아무 변경이 없으면 예약 작업을
 * **스스로 꺼버립니다.** 그러면 수집이 실패하는 게 아니라 **아예 안 돕니다.**
 * 빨간 X 도 없고 메일도 안 옵니다. 실패한 작업이 없으니까요.
 *
 * 그래서 이 판단만은 GitHub 이 아니라 **사이트 안에서** 합니다.
 * GitHub 이 통째로 멈춰도 화면은 대표님 브라우저에서 도니까요.
 *
 * 계산만 하는 파일입니다 (scripts/test-stale.mjs 가 그대로 시험합니다).
 */

export type StaleLevel = "ok" | "warn" | "bad";

export type Staleness = {
  /** 마지막 자료가 며칠 전인지 (오늘 자료면 0) */
  days: number;
  level: StaleLevel;
};

/**
 * 오늘 날짜(한국시간). 'YYYY-MM-DD'
 *
 * ⚠️ 서버는 세계표준시로 돕니다. 그냥 계산하면 한국 기준 오전 9시 이전에
 *    '어제' 가 나와서, 멀쩡한 자료를 하루 늦은 것으로 오해합니다.
 */
export function kstToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 두 날짜(YYYY-MM-DD) 사이의 날 수 */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/**
 * 언제부터 경고할지.
 *
 * 수집은 매일 06:00 에 시작해 07:30 쯤 끝납니다. 그 전에는 어제 것이
 * 가장 최신입니다. 그래서 **하루 전까지는 정상**입니다.
 *
 *   0~1일 전 → 정상 (아무것도 안 보여줍니다)
 *     2일 전 → 주의. 어제 수집이 안 됐습니다. 오늘 아침 자동 재시도합니다
 *   3일 이상 → 위험. 이틀 넘게 안 들어왔습니다. 사람이 봐야 합니다
 *
 * ⚠️ 자료를 못 읽은 것과 자료가 오래된 것은 다릅니다.
 *    못 읽었으면 이 함수를 부르지 마세요. 0건을 '3일째 없음' 으로
 *    보여주면, 데이터베이스가 잠깐 느린 것도 큰일처럼 보입니다.
 */
export const WARN_DAYS = 2;
export const BAD_DAYS = 3;

export function staleness(
  latest: string | null | undefined,
  today: string = kstToday()
): Staleness | null {
  if (!latest) return null; // 판단할 수 없음 — 지어내지 않습니다
  const days = daysBetween(latest, today);

  // 앞날 날짜가 들어오는 경우(시계가 어긋남 등)는 정상으로 봅니다.
  // 여기서 경고를 띄우면 원인을 찾을 수 없는 경고가 됩니다.
  if (days < 0) return { days: 0, level: "ok" };

  if (days >= BAD_DAYS) return { days, level: "bad" };
  if (days >= WARN_DAYS) return { days, level: "warn" };
  return { days, level: "ok" };
}
