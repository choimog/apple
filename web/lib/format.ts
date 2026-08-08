/**
 * 날짜·시각·숫자를 사람이 읽는 모양으로 바꿉니다.
 *
 * 【시각은 반드시 한국시간으로 — 2026-08-08 대표님 지적】
 * "수집 상태도 분까지는 나왔으면 좋겠고."
 * 데이터베이스는 세계표준시(UTC)로 저장합니다. 그대로 보여주면 9시간
 * 어긋난 시각이 나옵니다. 여기서 한 번에 한국시간으로 바꿉니다.
 */

const KST = "Asia/Seoul";

/** 2026-08-08 → "8월 8일 (금)" */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00+09:00`);
  const wd = ["일", "월", "화", "수", "목", "금", "토"][
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: KST, weekday: "short" })
        .formatToParts(d)
        .find((p) => p.type === "weekday")
        ? d.getUTCDay()
        : 0
    )
  ];
  const [, m, day] = iso.split("-");
  return `${Number(m)}월 ${Number(day)}일 (${wd})`;
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
