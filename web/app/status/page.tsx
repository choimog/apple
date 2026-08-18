import Link from "next/link";
import DataError from "@/components/DataError";
import { Card, CardHead, Empty, StatTile } from "@/components/ui";
import { configError } from "@/lib/supabase";
import { getArchivedRange, getSnapshotDates } from "@/lib/queries";
import { getCrawlDetail, getCrawlSummary } from "@/lib/queries-extra";
import { store, STORE_ORDER } from "@/lib/stores";
import { dayLabel, duration, kstTime, num } from "@/lib/format";

export const metadata = { title: "수집 상태" };

/**
 * 【2026-08-09 회원 전용으로 바꾸면서 화면 저장(캐시)을 뺐습니다】
 * 예전에는 화면을 잠깐 저장해 두고 여러 사람에게 그대로 보여줬습니다.
 * 이제는 접속마다 그 사람이 회원인지 확인해야 하므로 저장할 수 없습니다.
 * (Next.js 도 쿠키를 읽는 화면은 자동으로 저장하지 않습니다)
 *
 * 대신 화면을 열 때마다 데이터베이스를 읽습니다. 보는 사람이 몇 분이라
 * 속도 문제는 없습니다.
 */

export default async function StatusPage({
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

  let dates, archived, summary;
  try {
    [dates, archived, summary] = await Promise.all([
      getSnapshotDates(30),
      getArchivedRange(),
      getCrawlSummary(14),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  // 날짜별로 묶습니다 (서점 3개가 한 줄에 나란히 보이도록)
  const byDate = new Map<string, typeof summary.rows>();
  for (const r of summary.rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  const days = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  // 펼쳐 볼 날짜 — 주소에 date 가 있으면 그날의 분야별 상세를 함께 읽습니다
  const openDate =
    params.date && days.some(([d]) => d === params.date) ? params.date : null;

  let detail: Awaited<ReturnType<typeof getCrawlDetail>> = [];
  if (openDate) {
    try {
      detail = await getCrawlDetail(openDate);
    } catch (e) {
      return <DataError detail={String(e)} />;
    }
  }

  const latest = days[0];
  const latestOk = latest ? latest[1].reduce((a, r) => a + r.ok, 0) : 0;
  const latestFail = latest ? latest[1].reduce((a, r) => a + r.failed, 0) : 0;
  const latestItems = latest ? latest[1].reduce((a, r) => a + r.items, 0) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">수집 상태</h1>
        <p className="mt-1 text-sm text-ink-soft">
          매일 아침 6시에 자동 수집합니다.
        </p>
      </div>

      {/* ---------- 최근 수집 한눈에 ---------- */}
      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="마지막 수집일" value={dayLabel(latest[0])} />
          <StatTile label="성공" value={num(latestOk)} unit="분야" />
          <StatTile
            label="실패"
            value={num(latestFail)}
            unit="분야"
            tone={latestFail ? "accent" : "plain"}
          />
          <StatTile label="수집한 책" value={num(latestItems)} unit="권" />
        </div>
      )}

      {/* ---------- 날짜별 · 서점별 ---------- */}
      <Card>
        <CardHead
          title="날짜별 · 서점별 수집 기록"
          desc="실패 숫자를 누르면 어느 분야인지 볼 수 있습니다."
        />
        {days.length === 0 ? (
          <Empty title="아직 수집 기록이 없습니다" />
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-xs text-ink-faint">
                  <th className="px-4 py-2.5 text-left font-medium">날짜</th>
                  <th className="px-3 py-2.5 text-left font-medium">서점</th>
                  <th className="px-3 py-2.5 text-left font-medium">시작</th>
                  <th className="px-3 py-2.5 text-left font-medium">종료</th>
                  <th className="px-3 py-2.5 text-right font-medium">걸린 시간</th>
                  <th className="px-3 py-2.5 text-right font-medium">성공</th>
                  <th className="px-3 py-2.5 text-right font-medium">실패</th>
                  <th className="px-4 py-2.5 text-right font-medium">수집</th>
                </tr>
              </thead>
              <tbody>
                {days.map(([date, rows]) =>
                  STORE_ORDER.filter((sid) => rows.some((r) => r.storeId === sid)).map(
                    (sid, i) => {
                      const r = rows.find((x) => x.storeId === sid)!;
                      const s = store(sid);
                      const on = openDate === date;
                      return (
                        <tr
                          key={`${date}-${sid}`}
                          className={`border-b border-line-soft last:border-0 ${
                            on ? "bg-surface-2" : ""
                          }`}
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
                          <td className="tnum px-3 py-2.5 text-right text-xs text-emerald-600 dark:text-emerald-400">
                            {r.ok}
                          </td>
                          <td className="tnum px-3 py-2.5 text-right text-xs">
                            {r.failed ? (
                              <Link
                                href={`/status?date=${date}#report`}
                                scroll={false}
                                className="font-bold text-red-600 underline underline-offset-2 dark:text-red-400"
                              >
                                {r.failed}
                              </Link>
                            ) : (
                              <span className="text-ink-faint">0</span>
                            )}
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

      {/* ---------- 하루치 분야별 리포트 ---------- */}
      {openDate && <DayReport date={openDate} rows={detail} />}

      {/* ---------- 수집된 날짜 ---------- */}
      <Card>
        <CardHead title="수집된 날짜" desc="세 서점 중 하나라도 자료가 있는 날입니다." />
        <div className="flex flex-wrap gap-1.5 px-4 py-3.5 sm:px-5">
          {dates.map((d) => (
            <Link
              key={d}
              href={`/status?date=${d}#report`}
              scroll={false}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                d === openDate
                  ? "border-transparent bg-accent text-accent-ink"
                  : "border-line bg-surface-2 text-ink-soft hover:border-ink-faint"
              }`}
            >
              {d.slice(5)}
            </Link>
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
              이 기간을 다시 보려면 GitHub → Actions → <strong>보관소에서 불러오기</strong>
              에서 날짜를 지정하세요.
            </p>

            {/*
              GitHub 보관은 기한이 지나면 파일이 사라집니다.
              이게 안 보이면 모르는 사이에 자료가 없어집니다.

              ⚠️ 다 내려받으신 뒤에는 이 경고가 사라집니다.
                 (archives.saved_at 이 채워진 것은 세지 않습니다)
                 계속 떠 있으면 나중에 진짜 경고까지 무시하게 됩니다.
            */}
            {archived.expiring && !archived.expiresAt && (
              <p className="mt-2 text-xs text-ink-faint">
                ✅ 보관 파일은 모두 내려받아 두신 것으로 표시돼 있습니다.
              </p>
            )}
            {archived.expiring && archived.expiresAt && (
              <div
                className={`mt-3 rounded-xl border px-3 py-2.5 ${
                  (archived.daysLeft ?? 999) <= 30
                    ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40"
                    : "border-line bg-surface-2"
                }`}
              >
                <p className="text-sm font-semibold">
                  {(archived.daysLeft ?? 999) <= 30 ? "🚨" : "⏳"} 보관 파일이{" "}
                  <strong>{archived.expiresAt}</strong> 에 사라집니다
                  {archived.daysLeft !== null && ` (${archived.daysLeft}일 남음)`}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  보관 기간은 최대 90일입니다. 그 전에 내려받아 두세요.
                  한 번 사라지면 되살릴 수 없습니다.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                  받으신 뒤 GitHub → Actions →{" "}
                  <strong>보관 파일 만료 알림</strong> → Run workflow 에서
                  &lsquo;내려받아 저장을 마쳤습니다&rsquo; 를 true 로 두고
                  실행하시면 이 경고와 메일이 멈춥니다.
                </p>
                {archived.runUrl && (
                  <a
                    href={archived.runUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium hover:border-ink-faint"
                  >
                    → 내려받으러 가기
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * 하루치 분야별 리포트.
 *
 * 【2026-08-08 대표님 요청】
 * "수집 실패한 데이터는 수집상태에서 어디어디가 실패했는지 클릭하면
 *  리포트가 나오게 해줘."
 * 실패한 것을 맨 위에, 이유와 함께 보여줍니다. 성공한 분야는 접어 둡니다.
 */
function DayReport({
  date,
  rows,
}: {
  date: string;
  rows: Awaited<ReturnType<typeof getCrawlDetail>>;
}) {
  const failed = rows.filter((r) => r.status !== "success");
  const ok = rows.filter((r) => r.status === "success");

  // 같은 이유로 실패한 것끼리 묶습니다. 20개가 같은 원인이면 한 줄로 보입니다.
  const groups = new Map<string, typeof failed>();
  for (const r of failed) {
    const key = r.error ?? r.status;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  return (
    <Card id="report" className={failed.length ? "border-red-300/60 dark:border-red-900/60" : ""}>
      <CardHead
        title={`${dayLabel(date)} 수집 리포트`}
        desc={`분야 ${rows.length}개 · 성공 ${ok.length} · 실패 ${failed.length}`}
      />

      {rows.length === 0 ? (
        <Empty title="이 날짜의 수집 기록이 없습니다">
          수집이 아예 돌지 않았거나, 기록을 남기기 전에 멈췄을 수 있습니다.
        </Empty>
      ) : failed.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-soft sm:px-5">
          ✅ 이 날은 {ok.length}개 분야가 모두 성공했습니다.
        </p>
      ) : (
        <div className="divide-y divide-line-soft">
          {[...groups.entries()].map(([reason, items]) => (
            <div key={reason} className="px-4 py-3.5 sm:px-5">
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                {reason}
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">{items.length}개 분야</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {items.map((r, i) => (
                  <li
                    key={i}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs"
                  >
                    <span
                      className={`rounded px-1.5 py-0.5 text-2xs font-medium ${store(r.storeId).chip}`}
                    >
                      {store(r.storeId).short}
                    </span>
                    {r.name}
                    {r.kind === "weekly" && (
                      <span className="text-2xs text-ink-faint">주간</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {ok.length > 0 && (
        <details className="border-t border-line-soft px-4 py-3 sm:px-5">
          <summary className="cursor-pointer text-sm text-ink-soft">
            성공한 분야 {ok.length}개 보기
          </summary>
          <div className="scroll-x mt-3">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-line-soft text-ink-faint">
                  <th className="py-1.5 pr-3 text-left font-medium">서점</th>
                  <th className="py-1.5 pr-3 text-left font-medium">분야</th>
                  <th className="py-1.5 pr-3 text-right font-medium">수집</th>
                  <th className="py-1.5 text-left font-medium">끝난 시각</th>
                </tr>
              </thead>
              <tbody>
                {ok.map((r, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-2xs font-medium ${store(r.storeId).chip}`}
                      >
                        {store(r.storeId).short}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{r.name}</td>
                    <td className="tnum py-1.5 pr-3 text-right">{num(r.items)}</td>
                    <td className="tnum py-1.5 text-ink-faint">
                      {kstTime(r.finishedAt) ?? "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </Card>
  );
}
