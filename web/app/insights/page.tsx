import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import DatePicker from "@/components/DatePicker";
import {
  BarList,
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodBadge,
  PeriodSwitch,
  Pill,
  StatTile,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { dayLabel } from "@/lib/format";
import {
  getCategoryShare,
  getSnapshotDates,
  type Period,
} from "@/lib/queries";

export const metadata = { title: "분야 분석" };


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
    dates = await getSnapshotDates(400);
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
          <h1 className="text-2xl font-bold tracking-tight">
            어떤 분야가 종합 상위권을 채우고 있나
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            종합 상위 {top}권이 각각 어느 분야 목록에 올라 있는지 세어봤습니다.
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
            <DatePicker
              dates={dates}
              value={date}
              basePath="/insights"
              query={{ period, top: String(top) }}
            />
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
              <PeriodBadge period={period} withHelp />
            </span>
          }
          desc={`${dayLabel(date)} · 한 권이 여러 분야에 들 수 있어 합계는 ${top}권을 넘습니다 (지금 ${covered}권)`}
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
            }))}
            unit="권"
          />
        )}
      </Card>

    </div>
  );
}
