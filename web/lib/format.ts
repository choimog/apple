/**
 * 날짜·시각·숫자를 사람이 읽는 모양으로 바꿉니다.
 *
 * 【시각은 반드시 한국시간으로 — 2026-08-08 대표님 지적】
 * "수집 상태도 분까지는 나왔으면 좋겠고."
 * 데이터베이스는 세계표준시(UTC)로 저장합니다. 그대로 보여주면 9시간
 * 어긋난 시각이 나옵니다. 여기서 한 번에 한국시간으로 바꿉니다.
 */

const KST = "Asia/Seoul";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * "2026-08-12" → "8월 12일 (수)"
 *
 * 🚨 【2026-08-12 대표님 지적 — 요일이 하루씩 밀려 있었습니다】
 *   "수집하는 일자는 표기가 맞는데, 요일 표기가 하루씩 밀려서
 *    표기되는거 같은데?"
 *
 * 맞았습니다. 예전 코드는 이랬습니다.
 *
 *     const d = new Date(`${iso}T00:00:00+09:00`);   // 한국 자정
 *     ... d.getUTCDay()                             // ← UTC 기준 요일
 *
 * 한국 자정은 **세계표준시로는 전날 15시**입니다. 그래서 UTC 기준
 * 요일을 읽으면 언제나 **하루 전 요일**이 나옵니다.
 * 8월 12일(수) → '화' 로 나오고 있었습니다.
 *
 * 【왜 여기에 시간대가 아예 필요 없나요】
 * 넘어오는 값은 "2026-08-12" 같은 **달력 날짜**입니다. 몇 시인지는
 * 처음부터 없습니다. 수집 날짜는 이미 한국시간 기준으로 정해져
 * 저장된 값이라, 여기서 또 시간대를 씌우면 그때부터 어긋납니다.
 * 그래서 시각을 만들지 않고 **날짜 그대로** 요일을 셉니다.
 * (Date.UTC 를 쓰는 것은 시간대 영향을 아예 안 받게 하려는 것입니다)
 */
export function dayLabel(iso: string): string {
  const [y, m, day] = iso.split("-").map(Number);
  // 이상한 값이 와도 화면이 깨지지 않게 합니다 (요일만 비웁니다)
  if (!y || !m || !day) return iso;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
  return `${m}월 ${day}일 (${wd})`;
}

/** 2026-08-08 → "08-08" (좁은 자리용) */
export function shortDay(iso: string): string {
  return iso.slice(5);
}

/** 시각을 한국시간 '분' 까지: "8월 8일 06:12" */
export function kstDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const f = new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return f.format(d);
}

/** 시각을 한국시간 '분' 까지, 시:분만: "06:12" */
export function kstTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** 두 시각 사이를 "1시간 12분" 으로 */
export function duration(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.round(ms / 60000);
  if (min < 1) return "1분 미만";
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

/** "3분 전" / "2시간 전" — 얼마나 최근인지 감을 주기 위함 */
export function ago(value?: string | null): string | null {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

export function num(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : n.toLocaleString("ko-KR");
}
