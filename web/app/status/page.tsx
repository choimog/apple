import { configError, STORE_NAME } from "@/lib/supabase";
import { getRecentCrawlStatus, getSnapshotDates } from "@/lib/queries";
import DataError from "@/components/DataError";

// 수집 상태는 자주 바뀌므로 1분마다 다시 읽습니다.
export const revalidate = 60;

export default async function StatusPage() {
  if (configError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }

  let logs, dates;
  try {
    [logs, dates] = await Promise.all([
      getRecentCrawlStatus(40),
      getSnapshotDates(14),
    ]);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const failed = logs.filter((l) => l.status !== "success");

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h1 className="text-base font-bold">수집 상태</h1>
        <p className="mt-1 text-sm text-slate-600">
          매일 한국시간 오전 6시에 자동 수집합니다.
          이 화면은 <strong>실제 기록</strong>만 보여줍니다. 실패한 날은 실패로 나옵니다.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {dates.map((d) => (
            <span
              key={d}
              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800"
            >
              {d} 수집됨
            </span>
          ))}
          {dates.length === 0 && (
            <span className="text-sm text-slate-500">아직 수집된 날짜가 없습니다.</span>
          )}
        </div>

        {/* 접속은 됐는데 아무것도 못 읽은 경우 = 읽기 권한 문제일 가능성이 높습니다 */}
        {dates.length === 0 && logs.length === 0 && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-semibold text-amber-900">
              🔑 데이터베이스 읽기 권한 문제일 수 있습니다
            </p>
            <p className="mt-1">
              접속은 됐는데 기록을 하나도 못 읽었습니다. Supabase → SQL Editor 에서
              저장소의 <code className="rounded bg-amber-100 px-1">db/rls.sql</code> 을
              한 번 실행해 주세요. (읽기만 열고 쓰기·삭제는 막는 설정입니다)
            </p>
          </div>
        )}

        <div className="hidden">
        </div>
      </section>

      {failed.length > 0 && (
        <section className="rounded-lg border border-red-300 bg-red-50 p-4">
          <h2 className="text-sm font-bold text-red-900">
            실패한 수집 {failed.length}건
          </h2>
          <ul className="mt-2 space-y-1 text-xs text-red-800">
            {failed.map((l, i) => (
              <li key={i}>
                {l.snapshot_date} · {STORE_NAME[l.store_id as number] ?? "?"} ·{" "}
                {l.error_message ?? l.status}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-700">
            → GitHub → Actions 에서 해당 실행의 로그를 확인하세요.
            서점이 화면을 개편했다면 config/selectors.yaml 을 고쳐야 합니다.
          </p>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
          최근 수집 기록
        </h2>
        {logs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            기록이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="px-4 py-2 text-left">날짜</th>
                  <th className="px-4 py-2 text-left">서점</th>
                  <th className="px-4 py-2 text-left">상태</th>
                  <th className="px-4 py-2 text-right">수집 건수</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="px-4 py-2 tabular-nums">{l.snapshot_date}</td>
                    <td className="px-4 py-2">
                      {STORE_NAME[l.store_id as number] ?? "-"}
                    </td>
                    <td className="px-4 py-2">
                      {l.status === "success" ? (
                        <span className="text-emerald-700">✅ 성공</span>
                      ) : (
                        <span className="text-red-700">❌ {l.status}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {(l.items_collected as number)?.toLocaleString() ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
