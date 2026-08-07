import Link from "next/link";
import Cover from "@/components/Cover";
import RankChange from "@/components/RankChange";
import ExportButton from "@/components/ExportButton";
import DataError from "@/components/DataError";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import {
  getCategories,
  getPreviousDate,
  getRankings,
  getSnapshotDates,
  isWeekly,
} from "@/lib/queries";

// 매일 한 번 새 데이터가 들어오므로, 10분마다 다시 읽습니다.
export const revalidate = 600;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; date?: string; period?: string }>;
}) {
  if (configError) return <SetupNotice message={configError} />;

  const params = await searchParams;

  let categories, dates;
  try {
    [categories, dates] = await Promise.all([getCategories(), getSnapshotDates()]);
  } catch (e) {
    // 데이터베이스에 못 닿았을 때. "0건" 으로 위장하지 않고 사실대로 보여줍니다.
    return <DataError detail={String(e)} />;
  }

  if (!categories.length || !dates.length) {
    return (
      <EmptyNotice
        categoryCount={categories.length}
        dateCount={dates.length}
      />
    );
  }

  // ---- 기간 고르기: 일간(어제 하루) / 주간(최근 7일) ----
  // 두 목록은 분야 이름이 똑같아서(둘 다 '전체') 한 줄에 섞어 놓으면
  // 어느 쪽을 보고 있는지 알 수 없습니다. 그래서 먼저 기간부터 고릅니다.
  const period = params.period === "weekly" ? "weekly" : "daily";
  const inPeriod = categories.filter((c) =>
    period === "weekly" ? isWeekly(c) : !isWeekly(c)
  );
  // 아직 그 기간 데이터를 한 번도 안 모았으면 전체를 보여줍니다 (빈 화면 방지)
  const shown = inPeriod.length ? inPeriod : categories;

  const categoryId = Number(params.cat) || shown[0].id;
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const category =
    shown.find((c) => c.id === categoryId) ??
    categories.find((c) => c.id === categoryId) ??
    shown[0];

  let rows, prevDate;
  try {
    [rows, prevDate] = await Promise.all([
      getRankings(category.id, date, 200),
      getPreviousDate(category.id, date),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  return (
    <div className="space-y-5">
      {/* ---------- 기간 고르기 ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">집계 기간</h2>
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "daily", label: "일간", help: "어제 하루 판매 순위" },
            { key: "weekly", label: "주간", help: "최근 7일 누적 판매 순위" },
          ].map((p) => (
            <Link
              key={p.key}
              href={`/?period=${p.key}&date=${date}`}
              title={p.help}
              className={`rounded-full border px-3 py-1 text-xs ${
                p.key === period
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {period === "weekly"
            ? "주간 = 서점이 발표하는 최근 7일 누적 순위. 하루 출렁임이 걸러집니다."
            : "일간 = 어제 하루 판매 순위. 신간 반응이 가장 빨리 보입니다."}
        </p>

        <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-700">분야</h2>
        <div className="flex flex-wrap gap-1.5">
          {shown.map((c) => (
            <Link
              key={c.id}
              href={`/?cat=${c.id}&date=${date}&period=${period}`}
              className={`rounded-full border px-3 py-1 text-xs ${
                c.id === category.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {STORE_NAME[c.store_id]} · {c.branch_name || c.name}
              {c.branch_name ? ` · ${c.name}` : ""}
            </Link>
          ))}
        </div>

        <h2 className="mb-2 mt-4 text-sm font-semibold text-slate-700">날짜</h2>
        <div className="flex flex-wrap gap-1.5">
          {dates.slice(0, 14).map((d) => (
            <Link
              key={d}
              href={`/?cat=${category.id}&date=${d}&period=${period}`}
              className={`rounded border px-2 py-1 text-xs ${
                d === date
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
              }`}
            >
              {d.slice(5)}
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          ※ 목록에 없는 날짜는 그날 수집이 되지 않았다는 뜻입니다.
          (빈 데이터를 채워 넣지 않습니다)
        </p>
      </section>

      {/* ---------- 순위표 ---------- */}
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h1 className="text-base font-bold">
              <span
                className={`mr-2 rounded px-1.5 py-0.5 text-xs ${
                  STORE_COLOR[category.store_id]
                }`}
              >
                {STORE_NAME[category.store_id]}
              </span>
              {category.branch_name && `${category.branch_name} · `}
              {category.name}
              {/* 일간과 주간은 분야 이름이 같습니다. 반드시 구분해 보여줍니다. */}
              <span className="ml-2 rounded border border-slate-300 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                {isWeekly(category) ? "주간 · 최근 7일" : "일간 · 어제 하루"}
              </span>
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              {date} 기준 · {rows.length}권
              {prevDate ? ` · 등락은 ${prevDate} 대비` : " · 비교할 이전 기록 없음"}
            </p>
          </div>
          <ExportButton
            rows={rows}
            filename={`${STORE_NAME[category.store_id]}_${
              category.branch_name || category.name
            }_${isWeekly(category) ? "주간" : "일간"}_${date}`}
          />
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            이 날짜에 수집된 데이터가 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.rank} className="flex items-start gap-3 px-4 py-3">
                <div className="w-10 shrink-0 text-center">
                  <div className="text-lg font-bold tabular-nums">{r.rank}</div>
                  <RankChange change={r.change} isNew={r.isNew} />
                </div>

                <Cover url={r.store_book.cover_url} alt={r.store_book.raw_title} />

                <div className="min-w-0 flex-1">
                  {r.store_book.book_id ? (
                    <Link
                      href={`/book/${r.store_book.book_id}`}
                      className="font-medium hover:underline"
                    >
                      {r.store_book.raw_title}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.store_book.raw_title}</span>
                  )}
                  <p className="mt-0.5 text-sm text-slate-600">
                    {r.store_book.raw_author || "저자 정보 없음"}
                    {r.store_book.raw_publisher && ` · ${r.store_book.raw_publisher}`}
                    {r.store_book.pub_ym && ` · ${r.store_book.pub_ym}`}
                  </p>
                  {r.store_book.isbn13 && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      ISBN {r.store_book.isbn13}
                    </p>
                  )}
                </div>

                <div className="w-24 shrink-0 text-right">
                  {r.sales_point === null ? (
                    <span
                      className="text-xs text-slate-400"
                      title="이 서점은 판매지수를 제공하지 않습니다"
                    >
                      판매지수 없음
                    </span>
                  ) : (
                    <>
                      <div className="text-sm font-medium tabular-nums">
                        {r.sales_point.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-500">판매지수</div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SetupNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
      <h1 className="text-base font-bold text-amber-900">설정이 아직 안 됐습니다</h1>
      <p className="mt-2 whitespace-pre-line text-sm text-amber-800">{message}</p>
    </div>
  );
}

/**
 * 데이터가 안 보일 때의 안내.
 *
 * 【왜 이렇게 자세히 보여주나요?】
 * 그냥 "데이터가 없습니다" 라고만 하면 원인이 두 가지로 갈리는데 구분이 안 됩니다.
 *   (가) 진짜로 아직 한 번도 수집을 안 한 경우
 *   (나) 데이터는 있는데 사이트가 읽을 권한이 없는 경우 ← 훨씬 흔합니다
 * 그래서 무엇이 0인지 그대로 보여주고, 어느 쪽인지 판단할 수 있게 합니다.
 */
function EmptyNotice({
  categoryCount,
  dateCount,
}: {
  categoryCount: number;
  dateCount: number;
}) {
  // 분야까지 0이면 표를 아예 못 읽는 것 = 권한 문제일 가능성이 높습니다.
  const looksLikePermission = categoryCount === 0;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
      <h1 className="text-base font-bold text-amber-900">
        보여줄 데이터를 못 찾았습니다
      </h1>

      <div className="mt-3 rounded border border-amber-200 bg-white px-3 py-2 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">읽어온 분야 수</span>
          <span className="font-mono font-medium">{categoryCount}개</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-slate-600">읽어온 수집 날짜 수</span>
          <span className="font-mono font-medium">{dateCount}개</span>
        </div>
      </div>

      {looksLikePermission ? (
        <>
          <p className="mt-4 text-sm font-semibold text-amber-900">
            🔑 데이터베이스 읽기 권한 문제일 가능성이 높습니다
          </p>
          <p className="mt-1 text-sm text-amber-800">
            접속은 됐는데 표를 하나도 못 읽었습니다. 아래를 한 번만 하시면 됩니다.
          </p>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-amber-800">
            <li>
              Supabase 대시보드 → 왼쪽 <strong>SQL Editor</strong> → New query
            </li>
            <li>
              저장소의 <code className="rounded bg-amber-100 px-1">db/rls.sql</code>{" "}
              파일 전체를 복사해서 붙여넣고 <strong>Run</strong>
            </li>
            <li>이 화면을 새로고침 (최대 10분)</li>
          </ol>
          <p className="mt-2 text-xs text-amber-700">
            ※ 이 작업은 읽기만 열고 쓰기·삭제는 막습니다. 보안상 꼭 필요한 설정입니다.
          </p>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-amber-900">
            📥 아직 수집이 안 된 것 같습니다
          </p>
          <p className="mt-1 text-sm text-amber-800">
            GitHub → Actions → <strong>매일 수집 (daily crawl)</strong> →{" "}
            <strong>Run workflow</strong> 를 한 번 실행하세요.
            매일 아침 6시에는 자동으로 실행됩니다.
          </p>
        </>
      )}
    </div>
  );
}
