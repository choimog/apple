import Link from "next/link";
import DataError from "@/components/DataError";
import Markdown from "@/components/Markdown";
import { Card, CardHead, Empty, PageHead } from "@/components/ui";
import { configError } from "@/lib/supabase";
import { dayLabel, kstDateTime, num } from "@/lib/format";
import { getReport, monthCost, reportDates } from "@/lib/report";

export const metadata = { title: "오늘의 리포트" };

/**
 * AI 가 쓴 하루 요약.
 *
 * 【여기서는 리포트를 만들지 않습니다】
 * 만드는 것은 매일 아침 자동 작업(crawler/run_report.py)뿐입니다.
 * 화면에서 만들 수 있게 하면 새로고침 한 번마다 돈이 나갑니다.
 *
 * 【돈을 숨기지 않습니다】
 * 이 프로젝트에서 돈이 드는 유일한 기능이라, 이번 달에 얼마 썼는지를
 * 화면 아래에 항상 적어 둡니다.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }
  const params = await searchParams;

  let dates: string[];
  try {
    dates = await reportDates(60);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  // 주소에 있는 날짜가 실제로 있는 날짜일 때만 씁니다
  const want = params.date && dates.includes(params.date) ? params.date : undefined;

  let report;
  try {
    report = await getReport(want);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  // 이번 달 비용은 '보고 있는 리포트의 달' 기준입니다
  const ym = (report?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
  let cost: { count: number; usd: number } | null = null;
  try {
    cost = await monthCost(ym);
  } catch {
    // 비용을 못 읽는다고 리포트를 못 보게 할 이유는 없습니다.
    // 다만 0원으로 꾸며 보이지 않도록 null 로 둡니다.
    cost = null;
  }

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="리포트"
        title="오늘의 리포트"
        lead={
          <>
            어제 순위에서 무슨 일이 있었는지를 AI 가 한 장으로 정리합니다.
            <strong className="text-ink"> 순위 자료에 있는 것만</strong> 씁니다 —
            판매 부수·광고 같은 것은 자료에 없으므로 다루지 않습니다.
          </>
        }
      />

      {!report ? (
        <Card>
          <Empty title="아직 리포트가 없습니다">
            매일 아침 10시 30분에 자동으로 만들어집니다.
            <br />
            아직 안 켜셨다면{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">
              docs/ai-report-setup.md
            </code>{" "}
            를 보세요 (3분).
            <br />
            <span className="text-ink-faint">
              켜지 않으셔도 순위표·그래프·엑셀은 그대로 다 됩니다.
            </span>
          </Empty>
        </Card>
      ) : (
        <>
          {dates.length > 1 && (
            <div className="scroll-x flex items-center gap-1.5">
              {dates.slice(0, 21).map((d) => {
                const on = d === report.date;
                return (
                  <Link
                    key={d}
                    href={`/report?date=${d}`}
                    aria-current={on ? "page" : undefined}
                    className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                      on
                        ? "bg-accent font-semibold text-accent-ink"
                        : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    {d.slice(5)}
                  </Link>
                );
              })}
            </div>
          )}

          <Card>
            <CardHead
              title={`${dayLabel(report.date)} 순위 요약`}
              desc={
                kstDateTime(report.createdAt)
                  ? `${kstDateTime(report.createdAt)} 작성`
                  : undefined
              }
            />
            <div className="px-4 py-4 sm:px-5 sm:py-5">
              <Markdown text={report.body} />
            </div>

            {/*
              AI 가 쓴 글이라는 것을 숨기지 않습니다.
              대표님이 못 박으신 "된 것처럼 보이게 하지 마" 를 지키는 방법입니다.
            */}
            <div className="border-t border-line-soft px-4 py-3 text-xs leading-relaxed text-ink-faint sm:px-5">
              이 글은 <strong className="text-ink-soft">{report.model}</strong> 이(가)
              위 날짜의 순위 자료만 보고 쓴 것입니다. 사실 확인이 필요한 내용은{" "}
              <Link href="/best" className="underline hover:text-ink">
                종합 순위
              </Link>{" "}
              에서 직접 보세요.
              {report.inputTokens != null && report.outputTokens != null && (
                <>
                  {" · "}
                  글자 조각 {num(report.inputTokens)} 넣고 {num(report.outputTokens)} 나옴
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              title="이번 달 비용"
              desc="돈이 드는 유일한 기능이라 그대로 적어 둡니다"
            />
            <div className="px-4 py-4 text-sm sm:px-5">
              {cost === null ? (
                <p className="text-ink-faint">
                  지금은 비용을 읽지 못했습니다. (0원이라는 뜻이 아닙니다)
                </p>
              ) : (
                <p className="text-ink-soft">
                  {ym.replace("-", "년 ")}월 · <strong className="text-ink">{cost.count}건</strong>{" "}
                  · <strong className="text-ink">${cost.usd.toFixed(4)}</strong>{" "}
                  <span className="text-ink-faint">
                    (약 {Math.round(cost.usd * 1400).toLocaleString()}원)
                  </span>
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-ink-faint">
                한도는 <code className="rounded bg-surface-2 px-1 py-0.5">config/report.yaml</code>{" "}
                의 <code className="rounded bg-surface-2 px-1 py-0.5">monthly_cap_usd</code> 입니다.
                한도에 닿으면 그 달 남은 날은 리포트를 만들지 않고 멈춥니다.
                순위표와 그래프는 그대로 다 보입니다.
              </p>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
