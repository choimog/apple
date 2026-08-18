import Link from "next/link";
import BookRow from "@/components/BookRow";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import {
  Card,
  CardHead,
  Empty,
  PeriodSwitch,
  StatTile,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { dayLabel } from "@/lib/format";
import {
  getBooksOf,
  defaultDepth,
  getCategories,
  getSnapshotDates,
  unifiedOptions,
  NAME_KIND_LABEL,
  type NameKind,
  type Period,
} from "@/lib/queries";

/** 한 출판사(또는 저자)가 순위에 올린 책 목록 */
export default async function NameDetailPage({
  kind,
  params,
  searchParams,
}: {
  kind: NameKind;
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const sp = await searchParams;
  const word = NAME_KIND_LABEL[kind];
  const listHref = kind === "publisher" ? "/publishers" : "/authors";

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

  const period: Period = sp.period === "weekly" ? "weekly" : "daily";
  const date = sp.date && dates.includes(sp.date) ? sp.date : dates[0];
  const options = unifiedOptions(categories, period);
  const unified =
    sp.cat && options.some((o) => o.code === sp.cat) ? sp.cat : (options[0]?.code ?? "all");

  const { rows, ok } = await getBooksOf(kind, name, date, period, unified, {
    limit: 100,
  });

  // 화면에 '몇 위 안에 없습니다' 라고 적을 때 쓰는 숫자.
  // 모으는 기준과 같아야 합니다 (일간 300 · 주간 500).
  const depth = defaultDepth(period);
  // 순위가 없는 책(avgRank 가 빈 값)은 '가장 높은 순위' 계산에서 뺍니다.
  const ranked = rows.map((r) => r.avgRank).filter((v): v is number => v !== null);
  const best = ranked.length ? Math.min(...ranked) : null;
  const inThree = rows.filter((r) => r.storeCount >= 3).length;
  const href = (over: Record<string, string>) =>
    `?${new URLSearchParams({ period, cat: unified, date, ...over }).toString()}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-soft">
            <Link href={listHref} className="hover:underline">
              ← {word}별 순위
            </Link>
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-ink-soft">{dayLabel(date)}</p>
        </div>
        <PeriodSwitch period={period} hrefFor={(p) => href({ period: p })} />
      </div>

      {!ok && (
        <SetupNotice
          what={`${word} 화면은 데이터베이스가 계산해 주는 기능입니다. 아직 안 켜져 있어 값을 만들 수 없습니다.`}
        />
      )}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="순위에 올린 책" value={rows.length} unit="종" />
          <StatTile
            label="가장 높은 순위"
            value={best !== null ? best.toFixed(1) : "–"}
            unit="위"
            hint="3사 평균 순위 기준"
          />
          <StatTile
            label="3사 모두 올린 책"
            value={inThree}
            unit="종"
            hint="교보·예스24·알라딘 세 곳 모두의 순위에 있는 책"
          />
        </div>
      )}

      <Card>
        <CardHead
          title={`${name} · ${rows.length}종`}
          desc="번호는 이 목록 안에서의 차례입니다. 실제 순위는 서점별 칸에 있습니다."
        />
        {rows.length === 0 ? (
          <Empty>
            {ok
              ? `이 날짜·기간에는 ${word} "${name}" 의 책이 순위에 없습니다.`
              : "데이터베이스 계산 기능이 켜지면 여기에 목록이 나옵니다."}
          </Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r, i) => (
              <BookRow key={r.bookId} row={r} position={i + 1} depth={depth} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
