import Link from "next/link";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import {
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodBadge,
  PeriodSwitch,
  Pill,
  RankBadge,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import {
  getCategories,
  getNameRanking,
  getSnapshotDates,
  unifiedOptions,
  NAME_KIND_LABEL,
  PERIOD_HELP,
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
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates(30)]);
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
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
            분석 · {word}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{word}별 순위</h1>
          <p className="mt-1 text-sm text-ink-soft">
            3사 평균 순위를 바탕으로 <strong>어느 {word}가 상위권을 많이 차지하고
            있는지</strong> 봅니다. 이름을 누르면 그 {word}의 책 목록이 나옵니다.
          </p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p, cat: "" })} />
      </div>

      {!ok && (
        <SetupNotice
          what={`${word}별 순위는 데이터베이스가 계산해 주는 기능입니다. 아직 안 켜져 있어 값을 만들 수 없습니다. (자료가 없는 것이 아닙니다)`}
        />
      )}

      <Card className="p-4 sm:p-5">
        <FieldLabel>분야</FieldLabel>
        <div className="flex flex-wrap gap-1.5">
          {options.map((o) => (
            <Pill key={o.code} href={href({ cat: o.code })} active={o.code === unified}>
              {o.label}
            </Pill>
          ))}
        </div>
        <div className="mt-4">
          <FieldLabel>날짜</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {dates.slice(0, 10).map((d) => (
              <Pill key={d} href={href({ date: d })} active={d === date}>
                {d.slice(5)}
              </Pill>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHead
          title={
            <span className="flex flex-wrap items-center gap-2">
              {label} · {word} TOP {rows.length}
              <PeriodBadge period={period} withHelp />
            </span>
          }
          desc={`${date} 기준 · 각 서점 ${depth}위까지 봄`}
        />

        {rows.length === 0 ? (
          <Empty>
            {ok
              ? "이 조건에 해당하는 자료가 없습니다."
              : "데이터베이스 계산 기능이 켜지면 여기에 순위가 나옵니다."}
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-xs text-ink-soft">
                  <th className="w-14 px-4 py-2 text-left">순위</th>
                  <th className="px-3 py-2 text-left">{word}</th>
                  <th className="w-20 px-3 py-2 text-right">올린 책</th>
                  <th className="w-20 px-3 py-2 text-right">최고 순위</th>
                  <th className="w-40 px-4 py-2 text-right">점수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.name}
                    className="border-b border-slate-50 last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5">
                      <RankBadge rank={i + 1} size="sm" />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`${detail}/${encodeURIComponent(r.name)}?period=${period}&cat=${unified}&date=${date}`}
                        className="font-semibold hover:underline"
                      >
                        {r.name}
                      </Link>
                      {r.topTitles.length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-ink-faint">
                          {r.topTitles.join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tnum">
                      {r.books}
                    </td>
                    <td className="px-3 py-2.5 text-right tnum text-ink-soft">
                      {r.bestRank.toFixed(1)}위
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-blue-600"
                            style={{
                              width: `${Math.max(2, Math.round((r.score / topScore) * 100))}%`,
                            }}
                          />
                        </div>
                        <span className="w-14 text-right font-bold tnum">
                          {r.score.toLocaleString()}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            비교할 수 있게 만든 값입니다. 순위 자체가 아니라 <strong>상위권
            장악력</strong>을 봅니다.
          </p>
          {kind === "publisher" && (
            <p className="text-xs text-ink-soft">
              ※ 출판사 표기는 서점마다 다릅니다((주)문학동네 / 문학동네).
              &lsquo;(주)·주식회사·㈜&rsquo; 만 떼고 묶습니다. 그 이상은 임의로
              합치지 않습니다. 임프린트도 그대로 둡니다.
            </p>
          )}
          {kind === "author" && (
            <p className="text-xs text-ink-soft">
              ※ 저자는 서점 목록에 적힌 대표 저자 기준입니다. 공저·번역자는 대표
              1인으로 정리된 값을 씁니다.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
