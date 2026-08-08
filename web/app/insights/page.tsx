import Link from "next/link";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import {
  BarList,
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodSwitch,
  Pill,
  StatTile,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import {
  getCategoryShare,
  getSnapshotDates,
  PERIOD_HELP,
  PERIOD_LABEL,
  type Period,
} from "@/lib/queries";

export const revalidate = 600;

const TOP_CHOICES = [50, 100, 200];

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string; top?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const params = await searchParams;

  let dates;
  try {
    dates = await getSnapshotDates(30);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  if (!dates.length) {
    return (
      <Card>
        <Empty>아직 수집된 데이터가 없습니다.</Empty>
      </Card>
    );
  }

  const period: Period = params.period === "weekly" ? "weekly" : "daily";
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const top = TOP_CHOICES.includes(Number(params.top)) ? Number(params.top) : 100;

  const { rows, ok } = await getCategoryShare(date, period, top);
  const covered = rows.reduce((a, r) => a + r.books, 0);

  const href = (over: Record<string, string>) =>
    `/insights?${new URLSearchParams({ period, date, top: String(top), ...over }).toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            분석 · 분야
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
            어떤 분야가 종합 상위권을 채우고 있나
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            종합(전체) 상위 {top}권이 각각 <strong>어느 분야 목록에도 올라
            있는지</strong> 세어봤습니다. 지금 시장을 끌고 가는 분야가 무엇인지
            한눈에 보입니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p })} />
      </div>

      {!ok && (
        <SetupNotice what="분야 분석은 데이터베이스가 계산해 주는 기능입니다. 아직 안 켜져 있어 값을 만들 수 없습니다. (자료가 없는 것이 아닙니다)" />
      )}

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>상위 몇 권을 볼지</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {TOP_CHOICES.map((n) => (
                <Pill key={n} href={href({ top: String(n) })} active={n === top}>
                  상위 {n}권
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>날짜</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              {dates.slice(0, 10).map((d) => (
                <Pill key={d} href={href({ date: d })} active={d === date}>
                  {d.slice(5)}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="가장 센 분야" value={rows[0].label} />
          <StatTile
            label="그 분야가 차지한 책"
            value={rows[0].books}
            unit={`/ ${top}권`}
          />
          <StatTile label="분야 종류" value={rows.length} unit="개" />
        </div>
      )}

      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              분야별 상위 {top}권 점유
              <span
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  period === "weekly"
                    ? "bg-violet-100 text-violet-800"
                    : "bg-sky-100 text-sky-800"
                }`}
              >
                {PERIOD_LABEL[period]} · {PERIOD_HELP[period]}
              </span>
            </span>
          }
          desc={`${date} 기준 · 막대는 '몇 권' 입니다 (비율 아님)`}
        />
        {rows.length === 0 ? (
          <Empty>
            {ok
              ? "이 날짜에는 계산할 자료가 없습니다."
              : "데이터베이스 계산 기능이 켜지면 여기에 결과가 나옵니다."}
          </Empty>
        ) : (
          <BarList
            items={rows.map((r) => ({
              key: r.code,
              label: r.label,
              value: r.books,
              note: "권",
            }))}
          />
        )}
      </Card>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 sm:px-5">
        <p className="font-semibold text-slate-700">이 숫자를 읽는 법</p>
        <ul className="mt-1.5 space-y-1 text-xs">
          <li>
            · <strong>합계가 {top}권을 넘습니다</strong> (지금 {covered}권). 한 권이
            여러 분야에 들 수 있기 때문입니다. 예를 들어 소설 한 권이
            &lsquo;소설&rsquo;과 &lsquo;한국소설&rsquo; 양쪽에 올라 있습니다.
          </li>
          <li>
            · 그래서 <strong>비율(%)이 아니라 &lsquo;몇 권이 걸쳐 있나&rsquo;</strong>
            로 읽어야 맞습니다. 원그래프로 그리면 거짓말이 되므로 막대로 그렸습니다.
          </li>
          <li>
            · 분야 목록에 안 올라간 책은 어디에도 세어지지 않습니다. (분야 없이 종합
            에만 있는 책)
          </li>
        </ul>
        <p className="mt-2 text-xs">
          <Link href="/best" className="text-blue-700 hover:underline">
            → 종합 순위에서 실제 책 목록 보기
          </Link>
        </p>
      </div>
    </div>
  );
}
