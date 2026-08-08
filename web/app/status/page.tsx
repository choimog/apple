import DataError from "@/components/DataError";
import {
  Card,
  CardHead,
  Empty,
  PageHead,
  StatTile,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { getArchivedRange, getRecentCrawlStatus, getSnapshotDates } from "@/lib/queries";
import { getCrawlSummary } from "@/lib/queries-extra";
import { store, STORE_ORDER } from "@/lib/stores";
import { ago, dayLabel, duration, kstDateTime, kstTime, num } from "@/lib/format";

// 수집 상태는 자주 바뀌므로 1분마다 다시 읽습니다.
export const metadata = { title: "수집 상태" };

export const revalidate = 60;

export default async function StatusPage() {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  let logs, dates, archived, summary;
  try {
    [logs, dates, archived, summary] = await Promise.all([
      getRecentCrawlStatus(60),
      getSnapshotDates(14),
      getArchivedRange(),
      getCrawlSummary(7),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const failed = logs.filter((l) => l.status !== "success");

  // 날짜별로 묶습니다 (서점 3개가 한 줄에 나란히 보이도록)
  const byDate = new Map<string, typeof summary.rows>();
  for (const r of summary.rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const latest = days[0];
  const latestFinish = latest
    ? latest[1].reduce<string | null>(
        (acc, r) => (!acc || (r.finishedAt ?? "") > acc ? (r.finishedAt ?? acc) : acc),
        null
      )
    : null;
  const latestOk = latest ? latest[1].reduce((a, r) => a + r.ok, 0) : 0;
  const latestFail = latest ? latest[1].reduce((a, r) => a + r.failed, 0) : 0;
  const latestItems = latest ? latest[1].reduce((a, r) => a + r.items, 0) : 0;

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="상태"
        title="수집 상태"
        lead={
          <>
            매일 한국시간 오전 6시에 자동 수집합니다. 이 화면은{" "}
            <strong>실제 기록만</strong> 보여줍니다. 실패한 날은 실패로 나옵니다.
          </>
        }
      />

      {/* ---------- 최근 수집 한눈에 ---------- */}
      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="마지막 수집일"
            value={dayLabel(latest[0])}
            hint={latest[0]}
          />
          <StatTile
            label="끝난 시각"
            value={kstDateTime(latestFinish) ?? "–"}
            hint={
              latestFinish
                ? `${ago(latestFinish) ?? ""} · 한국시간`
                : "종료 시각 기록 없음"
            }
          />
          <StatTile
            label="성공 / 실패"
            value={`${latestOk} / ${latestFail}`}
            unit="분야"
            hint={latestFail === 0 ? "전부 성공" : "실패 목록은 아래에 있습니다"}
          />
          <StatTile label="수집한 책" value={num(latestItems)} unit="권" />
        </div>
      )}

      {/* ---------- 서점별 시작·종료 시각 ---------- */}
      <Card>
        <CardHead
          title="날짜별 · 서점별 수집 기록"
          desc="시작·종료 시각은 한국시간이며 분까지 표시합니다."
        />
        {days.length === 0 ? (
          <Empty title="아직 수집 기록이 없습니다">
            GitHub → Actions → <strong>매일 수집 (daily crawl)</strong> 에서 실행
            결과를 확인하세요.
          </Empty>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-xs text-ink-faint">
                  <th className="px-4 py-2.5 text-left font-medium">날짜</th>
                  <th className="px-3 py-2.5 text-left font-medium">서점</th>
                  <th className="px-3 py-2.5 text-left font-medium">시작</th>
                  <th className="px-3 py-2.5 text-left font-medium">종료</th>
                  <th className="px-3 py-2.5 text-right font-medium">걸린 시간</th>
                  <th className="px-3 py-2.5 text-right font-medium">성공/실패</th>
                  <th className="px-4 py-2.5 text-right font-medium">수집</th>
                </tr>
              </thead>
              <tbody>
                {days.map(([date, rows]) =>
                  STORE_ORDER.filter((sid) => rows.some((r) => r.storeId === sid)).map(
                    (sid, i) => {
                      const r = rows.find((x) => x.storeId === sid)!;
                      const s = store(sid);
                      return (
                        <tr
                          key={`${date}-${sid}`}
                          className="border-b border-line-soft last:border-0"
                        >
                          <td className="px-4 py-2.5 text-xs text-ink-soft">
                            {i === 0 ? dayLabel(date) : ""}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`rounded-md px-2 py-0.5 text-2xs font-medium ${s.chip}`}
                            >
                              {s.name}
                            </span>
                          </td>
                          <td className="tnum px-3 py-2.5 text-xs">
                            {kstTime(r.startedAt) ?? "–"}
                          </td>
                          <td className="tnum px-3 py-2.5 text-xs">
                            {kstTime(r.finishedAt) ?? "–"}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-ink-soft">
                            {duration(r.startedAt, r.finishedAt) ?? "–"}
                          </td>
                          <td className="tnum px-3 py-2.5 text-right text-xs">
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {r.ok}
                            </span>
                            <span className="text-ink-faint"> / </span>
                            <span
                              className={
                                r.failed
                                  ? "font-bold text-red-600 dark:text-red-400"
                                  : "text-ink-faint"
                              }
                            >
                              {r.failed}
                            </span>
                          </td>
                          <td className="tnum px-4 py-2.5 text-right text-xs font-medium">
                            {num(r.items)}
                          </td>
                        </tr>
                      );
                    }
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
        {!summary.ok && (
          <p className="border-t border-line-soft px-4 py-3 text-xs text-ink-faint sm:px-5">
            ⚙️ 시작·종료 시각을 보려면 Supabase 에서 <code>db/perf.sql</code> 을 한 번
            실행해 주세요.
          </p>
        )}
      </Card>

      {/* ---------- 수집된 날짜 ---------- */}
      <Card>
        <CardHead
          title="수집된 날짜"
          desc="여기 없는 날짜는 그날 수집이 되지 않았다는 뜻입니다. 빈 데이터를 채워 넣지 않습니다."
        />
        <div className="flex flex-wrap gap-1.5 px-4 py-3.5 sm:px-5">
          {dates.map((d) => (
            <span
              key={d}
              className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-soft"
            >
              {dayLabel(d)}
            </span>
          ))}
          {dates.length === 0 && (
            <span className="text-sm text-ink-faint">아직 수집된 날짜가 없습니다.</span>
          )}
        </div>

        {archived && (
          <div className="border-t border-line-soft px-4 py-3.5 text-sm sm:px-5">
            <p className="font-semibold">📦 보관소로 옮겨진 기간</p>
            <p className="mt-1 text-ink-soft">
              <strong>{archived.from}</strong> ~ <strong>{archived.to}</strong> (
              {archived.days}일 · {num(archived.rows)}건)
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              데이터는 지워지지 않았습니다. Supabase 용량을 위해 Cloudflare R2 로
              옮겨 두었고, 파일로 내려받을 수 있습니다. (docs/archive-setup.md)
            </p>
          </div>
        )}

        {dates.length === 0 && logs.length === 0 && (
          <div className="border-t border-line-soft px-4 py-3.5 text-sm sm:px-5">
            <p className="font-semibold text-amber-700 dark:text-amber-400">
              🔑 데이터베이스 읽기 권한 문제일 수 있습니다
            </p>
            <p className="mt-1 text-ink-soft">
              접속은 됐는데 기록을 하나도 못 읽었습니다. Supabase → SQL Editor 에서
              저장소의 <code>db/rls.sql</code> 을 한 번 실행해 주세요.
            </p>
          </div>
        )}
      </Card>

      {/* ---------- 실패 목록 ---------- */}
      {failed.length > 0 && (
        <Card className="border-red-300/60 dark:border-red-900/60">
          <CardHead
            title={
              <span className="text-red-700 dark:text-red-400">
                실패한 수집 {failed.length}건
              </span>
            }
            desc="실패해도 나머지 분야는 정상 저장됩니다. 같은 분야가 매일 실패하면 알려주세요."
          />
          <ul className="divide-y divide-line-soft">
            {failed.slice(0, 30).map((l, i) => (
              <li key={i} className="px-4 py-2.5 text-xs sm:px-5">
                <span className="text-ink-faint">{l.snapshot_date}</span>
                <span className="mx-2 font-medium">
                  {store(l.store_id as number).name}
                </span>
                <span className="text-red-700 dark:text-red-400">
                  {(l.error_message as string) ?? (l.status as string)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line-soft px-4 py-3 text-xs text-ink-faint sm:px-5">
            → GitHub → Actions 에서 해당 실행의 로그를 확인하세요. 서점이 화면을
            개편했다면 <code>config/selectors.yaml</code> 을 고쳐야 합니다.
          </p>
        </Card>
      )}
    </div>
  );
}
