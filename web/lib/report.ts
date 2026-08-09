/**
 * AI 일일 리포트 읽기.
 *
 * 쓰는 쪽은 crawler/run_report.py 입니다 (관리자 열쇠로 저장).
 * 여기서는 **읽기만** 합니다. 사이트에서는 리포트를 만들 수 없습니다
 * — 화면에서 만들 수 있게 하면 새로고침 한 번마다 돈이 나갑니다.
 */

import { db } from "@/lib/supabase";

/**
 * 리포트를 며칠치 남기는지.
 *
 * 【2026-08-09 대표님 승인】
 * "리포트도 기록이 지워질 때, 해당 일자에 해당하는 건 함께 지워줘도 돼."
 * 매주 보관 작업이 이보다 오래된 리포트를 지웁니다.
 *
 * ⚠️ config/archive.yaml 의 log_keep_days 와 같아야 합니다.
 *    여기 숫자만 고치면 화면이 거짓말을 합니다 (실제로는 그대로 지워짐).
 */
export const REPORT_KEEP_DAYS = 180;

export type Report = {
  date: string;
  model: string;
  body: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: string | null;
};

function shape(r: Record<string, unknown>): Report {
  return {
    date: String(r.report_date),
    model: String(r.model ?? ""),
    body: String(r.content_md ?? ""),
    inputTokens: r.input_tokens == null ? null : Number(r.input_tokens),
    outputTokens: r.output_tokens == null ? null : Number(r.output_tokens),
    costUsd: r.cost_usd == null ? null : Number(r.cost_usd),
    createdAt: r.created_at == null ? null : String(r.created_at),
  };
}

/** 리포트가 있는 날짜들 (최근 순) */
export async function reportDates(limit = 400): Promise<string[]> {
  const { data, error } = await db()
    .from("daily_reports")
    .select("report_date")
    .order("report_date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => String(r.report_date));
}

/** 특정 날짜(없으면 가장 최근) 리포트 하나 */
export async function getReport(date?: string): Promise<Report | null> {
  let q = db().from("daily_reports").select("*");
  if (date) q = q.eq("report_date", date);
  const { data, error } = await q
    .order("report_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return rows.length ? shape(rows[0] as Record<string, unknown>) : null;
}

/**
 * 이번 달에 쓴 돈. 화면에 그대로 보여줍니다.
 *
 * 돈이 드는 유일한 기능이므로, 얼마 쓰고 있는지는 숨기지 않고
 * 리포트 화면 아래에 항상 적어 둡니다.
 */
export async function monthCost(
  yyyymm: string
): Promise<{ count: number; usd: number }> {
  const first = `${yyyymm}-01`;
  // 다음 달 1일 '미만' 으로 자릅니다 (말일이 28/30/31 로 달라서)
  const [y, m] = yyyymm.split("-").map(Number);
  const next =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;

  const { data, error } = await db()
    .from("daily_reports")
    .select("cost_usd")
    .gte("report_date", first)
    .lt("report_date", next);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  return {
    count: rows.length,
    usd: rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
  };
}
