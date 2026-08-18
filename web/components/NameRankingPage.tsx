import Link from "next/link";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import DatePicker from "@/components/DatePicker";
import CategoryPicker, { PickerBar, PickerSide } from "@/components/CategoryPicker";
import {
  Card,
  CardHead,
  Empty,
  PeriodBadge,
  PeriodSwitch,
  RankBadge,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { dayLabel } from "@/lib/format";
import {
  getCategories,
  getNameRanking,
  getSnapshotDates,
  unifiedOptions,
  NAME_KIND_LABEL,
  PERIOD_LABEL,
  type NameKind,
  type Period,
} from "@/lib/queries";

/**
 * 출판사 순위 / 저자 순위 — 두 화면이 완전히 같은 모양이라 하나로 만듭니다.
 */
export default async function NameRankingPage({
  kind,
  searchParams,
}: {
  kind: NameKind;
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const params = await searchParams;
  const word = NAME_KIND_LABEL[kind];
  const base = kind === "publisher" ? "/publishers" : "/authors";
  const detail = kind === "publisher" ? "/publisher" : "/author";

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(400)]);
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
  const options = unifiedOptions(categories, period);
  const unified =
    params.cat && options.some((o) => o.code === params.cat)
      ? params.cat
      : (options[0]?.code ?? "all");

  const { rows, ok, depth } = await getNameRanking(kind, date, period, unified, {
    limit: 50,
  });
  const label = options.find((o) => o.code === unified)?.label ?? unified;
  const topScore = rows[0]?.score ?? 1;

  const href = (over: Record<string, string>) =>
    `${base}?${new URLSearchParams({ period, cat: unified, date, ...over }).toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{word}별 순위</h1>
          <p className="mt-1 text-sm text-ink-soft">
            이름을 누르면 그 {word}의 책 목록이 나옵니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p, cat: "" })} />
      </div>

      {!ok && (
        <SetupNotice
          what={`${word}별 순위는 데이터베이스가 계산해 주는 기능입니다. 아직 안 켜져 있어 값을 만들 수 없습니다. (자료가 없는 것이 아닙니다)`}
        />
      )}

      {/* 분야·날짜 고르기는 [종합]·[서점별]과 **같은 부품**입니다.
          예전에는 여기만 분야가 한 줄을 다 쓰고 날짜가 아랫줄이라,
          같은 분야 수인데도 스크롤이 생기는 시점이 달랐습니다.
          (2026-08-18 대표님 요청으로 하나로 모았습니다) */}
      <Card className="p-4 sm:p-5">
        <PickerBar>
          <CategoryPicker
            items={options.map((o) => ({
              key: o.code,
              label: o.label,
              href: href({ cat: o.code }),
            }))}
            activeKey={unified}
          />
          <PickerSide label="날짜">
            <DatePicker
              dates={dates}
              value={date}
              basePath={base}
              query={{ period, cat: unified }}
            />
          </PickerSide>
        </PickerBar>
      </Card>

      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              {label} · {word} TOP {rows.length}
              <PeriodBadge period={period} withHelp />
            </span>
          }
          desc={dayLabel(date)}
        />

        {rows.length === 0 ? (
          <Empty>
            {ok
              ? "이 조건에 해당하는 자료가 없습니다."
              : "데이터베이스 계산 기능이 켜지면 여기에 순위가 나옵니다."}
          </Empty>
        ) : (
          /*
            좌우 스크롤 없는 목록.

            【2026-08-08 대표님 지적】
            "출판사별 순위, 저자 순에서 보이는 데이터의 좌우가 너무 길어서
             스크롤이 생기는데, 이게 좀 불편해."

            예전에는 칸 5개짜리 표(최소 640px)라 좁은 화면에서 옆으로
            밀어야 했습니다. 표를 버리고, 한 줄 안에서 아래로 쌓이는
            모양으로 바꿨습니다. 어떤 너비에서도 옆으로 넘치지 않습니다.
          */
          <ul className="divide-y divide-line-soft">
            {rows.map((r, i) => (
              <li key={r.name} className="px-4 py-3 hover:bg-surface-2 sm:px-5">
                <div className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <RankBadge rank={i + 1} size="sm" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <Link
                        href={`${detail}/${encodeURIComponent(r.name)}?period=${period}&cat=${unified}&date=${date}`}
                        className="truncate font-semibold hover:underline"
                      >
                        {r.name}
                      </Link>
                      <span className="tnum shrink-0 text-sm font-bold">
                        {r.score.toLocaleString()}
                        <span className="ml-1 text-2xs font-normal text-ink-faint">
                          점
                        </span>
                      </span>
                    </div>

                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-soft">
                      <span className="tnum">{r.books}종</span>
                      <span className="text-ink-faint">·</span>
                      <span className="tnum">최고 {r.bestRank.toFixed(1)}위</span>
                    </p>

                    {r.topTitles.length > 0 && (
                      <p className="mt-0.5 truncate text-xs text-ink-faint">
                        {r.topTitles.join(" · ")}
                      </p>
                    )}

                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.max(2, Math.round((r.score / topScore) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <details className="rounded-xl border border-line bg-surface px-4 py-3 text-sm sm:px-5">
        <summary className="cursor-pointer font-semibold text-ink-soft">
          점수는 어떻게 매기나요?
        </summary>
        <div className="mt-2 space-y-1 text-ink-soft">
          <p>
            책 한 권마다 <strong>({depth} + 1) − 평균순위</strong> 만큼 점수를 주고,
            그 {word}의 책을 전부 더합니다.
          </p>
          <ul className="ml-4 list-disc space-y-0.5 text-xs">
            <li>평균 3위인 책 → {depth + 1 - 3}점</li>
            <li>평균 250위인 책 → {depth + 1 - 250}점</li>
          </ul>
          <p className="text-xs">
            &ldquo;1위 한 권&rdquo;과 &ldquo;200위권 열 권&rdquo; 중 어느 쪽이 센지
            비교하기 위한 값입니다.
          </p>
        </div>
      </details>
    </div>
  );
}
