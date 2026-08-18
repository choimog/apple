/**
 * 용량 기록 읽기.
 *
 * 【2026-08-18 대표님 요청】
 *   "혹시 남은 저장용량을 사이트에 올려서 확인할 수 있나?
 *    매칭 검토처럼 관리자 페이지에 말이지."
 *
 * 🚨 【여기서는 아무것도 계산하지 않습니다】
 * 재는 일은 crawler/capacity.py 한 곳에서만 합니다. 그 파일 맨 위에
 * 이렇게 적혀 있습니다.
 *
 *   "원래 사이트 쪽 검사(web/scripts)에 있던 것을 옮겼습니다.
 *    같은 계산을 두 군데 두면 반드시 어긋납니다. 한쪽만 고치게 되니까요."
 *
 * **한 번 옮겨 온 계산입니다.** 2026-08-18 하루에만 그 계산을 두 번
 * 고쳤습니다. 여기에 다시 만들면 그 수정이 화면에는 안 들어갑니다.
 * 그래서 이 파일은 **읽어서 넘기기만** 합니다.
 */

import { db } from "./supabase";

export type CapacityRow = {
  measuredOn: string;
  totalMb: number;
  limitMb: number;
  dailyMb: number | null;
  catalogMb: number | null;
  slowMb: number | null;
  perDay: number | null;
  /** null = 아직 못 쟀음. 0 과 다릅니다 */
  catalogDay: number | null;
  slowDay: number | null;
  steadyMb: number | null;
  /** 999 = 한도에 닿지 않음 */
  daysLeft: number | null;
  stalePrune: boolean;
  problem: string | null;
};

type Raw = {
  measured_on: string;
  total_mb: number;
  limit_mb: number;
  daily_mb: number | null;
  catalog_mb: number | null;
  slow_mb: number | null;
  per_day: number | null;
  catalog_day: number | null;
  slow_day: number | null;
  steady_mb: number | null;
  days_left: number | null;
  stale_prune: boolean;
  problem: string | null;
};

const shape = (r: Raw): CapacityRow => ({
  measuredOn: r.measured_on,
  totalMb: r.total_mb,
  limitMb: r.limit_mb,
  dailyMb: r.daily_mb,
  catalogMb: r.catalog_mb,
  slowMb: r.slow_mb,
  perDay: r.per_day,
  catalogDay: r.catalog_day,
  slowDay: r.slow_day,
  steadyMb: r.steady_mb,
  daysLeft: r.days_left,
  stalePrune: r.stale_prune,
  problem: r.problem,
});

/**
 * 최근 기록을 새것부터 돌려줍니다.
 *
 * needsSql = true 면 db/capacity-log.sql 을 아직 실행하지 않은 것입니다.
 * 고장이 아니므로 화면에서 안내만 합니다.
 */
export async function recentCapacity(
  days = 30
): Promise<{ rows: CapacityRow[]; needsSql: boolean }> {
  const { data, error } = await db()
    .from("capacity_log")
    .select(
      "measured_on,total_mb,limit_mb,daily_mb,catalog_mb,slow_mb,per_day,catalog_day,slow_day,steady_mb,days_left,stale_prune,problem"
    )
    .order("measured_on", { ascending: false })
    .limit(Math.max(1, Math.min(days, 400)));

  if (error) {
    const msg = String(error.message ?? error);
    const missing =
      msg.includes("capacity_log") &&
      (msg.includes("does not exist") ||
        msg.includes("schema cache") ||
        msg.includes("Could not find"));
    return { rows: [], needsSql: missing };
  }
  return { rows: ((data ?? []) as Raw[]).map(shape), needsSql: false };
}

/**
 * 며칠 사이에 실제로 얼마나 늘었나.
 *
 * 🚨 이건 계산이 아니라 **뺄셈**입니다. 기록된 두 값의 차이일 뿐이라
 *    capacity.py 의 판단과 겹치지 않습니다.
 *    (겹치면 두 곳이 어긋납니다 — 이 파일을 만든 이유가 그것입니다)
 */
export function changeOver(
  rows: CapacityRow[],
  days: number
): { mb: number; from: string; realDays: number } | null {
  if (rows.length < 2) return null;
  const newest = rows[0];
  // 원하는 날수에 가장 가까운 옛 기록. 없으면 가장 오래된 것.
  const want = new Date(newest.measuredOn);
  want.setDate(want.getDate() - days);
  const target = want.toISOString().slice(0, 10);
  const older = rows.find((r) => r.measuredOn <= target) ?? rows[rows.length - 1];
  if (older.measuredOn === newest.measuredOn) return null;

  const a = new Date(newest.measuredOn).getTime();
  const b = new Date(older.measuredOn).getTime();
  return {
    mb: newest.totalMb - older.totalMb,
    from: older.measuredOn,
    realDays: Math.max(1, Math.round((a - b) / 86400000)),
  };
}
