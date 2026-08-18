import Link from "next/link";
import { Card, CardHead, Empty, StatTile } from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { dayLabel } from "@/lib/format";
import { changeOver, recentCapacity } from "@/lib/capacity";

export const metadata = { title: "저장 용량" };

/**
 * 저장 용량 — 관리자 전용.
 *
 * 【2026-08-18 대표님 요청】
 *   "혹시 남은 저장용량을 사이트에 올려서 확인할 수 있나?
 *    매칭 검토처럼 관리자 페이지에 말이지."
 *
 * 🚨 【이 화면은 아무것도 계산하지 않습니다】
 * 재는 일은 crawler/capacity.py 가 매일 수집 뒤에 합니다. 여기는 그
 * 결과를 **읽어서 보여주기만** 합니다. 같은 계산을 두 군데 두면 반드시
 * 어긋나기 때문입니다 (capacity.py 맨 위 설명 참고).
 *
 * 【왜 표에 담아 두나요 — 함수를 바로 부르면 안 되나요?】
 * Supabase 함수 권한은 '회원' 단위로만 줄 수 있고 관리자만 따로 줄 수
 * 없습니다. table_sizes() 를 회원에게 열면 이 화면을 막아도 **공개
 * 열쇠로 직접 부르면 표 이름과 크기가 다 보입니다.** 표는 RLS 로
 * 관리자만 읽게 막을 수 있어서 그 방법을 씁니다 (db/capacity-log.sql).
 */
export default async function CapacityPage() {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  if ((await currentRole()) !== "admin") {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-soft">이 화면은 관리자만 쓸 수 있습니다.</p>
      </Card>
    );
  }

  const { rows, needsSql } = await recentCapacity(60);

  if (needsSql) {
    return (
      <div className="space-y-5">
        <Head />
        <Card>
          <Empty title="아직 기록이 없습니다">
            Supabase 에서{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">db/capacity-log.sql</code>{" "}
            을 한 번 실행해 주세요. 그다음 [매일 수집] 부터 하루 한 줄씩
            쌓입니다.
          </Empty>
        </Card>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="space-y-5">
        <Head />
        <Card>
          <Empty title="아직 기록이 없습니다">
            내일 아침 수집이 끝나면 첫 줄이 생깁니다.
          </Empty>
        </Card>
      </div>
    );
  }

  const now = rows[0];
  const left = Math.max(0, now.limitMb - now.totalMb);
  const pct = Math.min(100, (now.totalMb / now.limitMb) * 100);
  const week = changeOver(rows, 7);

  // 🚨 999 는 '한도에 닿지 않는다' 는 뜻입니다 (capacity.py).
  //    숫자 그대로 "999일 남음" 이라고 적으면 거짓말이 됩니다.
  const neverFull = (now.daysLeft ?? 0) >= 999;

  const tone =
    pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok";
  const barColor =
    tone === "bad"
      ? "bg-red-500"
      : tone === "warn"
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="space-y-5">
      <Head />

      {/* ---------- 지금 상태 ---------- */}
      <Card>
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-ink-soft">
              <strong className="tnum text-2xl text-ink">
                {now.totalMb.toFixed(0)}
              </strong>
              <span className="tnum"> / {now.limitMb}MB</span>
            </p>
            <p className="tnum text-sm text-ink-soft">
              남음 <strong className="text-ink">{left.toFixed(0)}MB</strong>
            </p>
          </div>

          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full ${barColor}`}
              style={{ width: `${Math.max(1, pct)}%` }}
            />
          </div>

          <p className="mt-2 text-2xs text-ink-faint">
            {dayLabel(now.measuredOn)} 기준 · 매일 수집이 끝나면 다시 잽니다
          </p>
        </div>
      </Card>

      {/* ---------- 🚨 문제가 있으면 ---------- */}
      {now.problem && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300 sm:px-5"
        >
          <p className="font-semibold">확인이 필요합니다</p>
          <p className="mt-1 text-xs leading-relaxed">{now.problem}</p>
          {now.stalePrune && (
            <p className="mt-2 text-xs">
              <Link
                href="https://github.com/choimog/apple/actions/workflows/prune-catalog.yml"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                [도서 목록 정리] 열기 ↗
              </Link>
            </p>
          )}
        </div>
      )}

      {/* ---------- 한눈에 ---------- */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="도달점"
          value={now.steadyMb === null ? "—" : now.steadyMb.toFixed(0)}
          unit="MB"
        />
        <StatTile
          label={neverFull ? "한도까지" : "남은 날"}
          value={neverFull ? "안 참" : String(now.daysLeft ?? "—")}
          unit={neverFull ? "" : "일"}
          tone={!neverFull && (now.daysLeft ?? 999) < 30 ? "accent" : "plain"}
        />
        <StatTile
          label="최근 7일"
          value={
            week ? `${week.mb >= 0 ? "+" : ""}${week.mb.toFixed(0)}` : "—"
          }
          unit="MB"
        />
        <StatTile label="기록" value={String(rows.length)} unit="일" />
      </div>

      {/* ---------- 무엇이 차지하나 ---------- */}
      <Card>
        <CardHead title="무엇이 차지하나" desc="하루에 얼마씩 늘어나는지도 함께" />
        <div className="scroll-x">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-xs text-ink-faint">
                <th className="px-4 py-2.5 text-left font-medium sm:px-5">항목</th>
                <th className="px-3 py-2.5 text-right font-medium">지금</th>
                <th className="px-3 py-2.5 text-right font-medium">하루에</th>
                <th className="px-4 py-2.5 text-left font-medium sm:px-5">멈추나</th>
              </tr>
            </thead>
            <tbody>
              <Line
                name="순위 기록"
                mb={now.dailyMb}
                day={now.perDay}
                stop="14일치에서 멈춤"
              />
              <Line
                name="도서 목록"
                mb={now.catalogMb}
                day={now.catalogDay}
                stop="14일치에서 멈춤"
                /* 🚨 못 쟀을 때 0 으로 보이면 '안 늘어난다' 로 읽힙니다 */
                unknown={now.catalogDay === null}
              />
              <Line
                name="수집 기록·리포트"
                mb={now.slowMb}
                day={now.slowDay}
                stop="180일치에서 멈춤"
              />
            </tbody>
          </table>
        </div>
      </Card>

      {/* ---------- 날짜별 ---------- */}
      <Card>
        <CardHead title="날짜별" desc="실제로 며칠에 얼마나 늘었는지" />
        <div className="scroll-x">
          <table className="w-full min-w-[380px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-xs text-ink-faint">
                <th className="px-4 py-2 text-left font-medium sm:px-5">날짜</th>
                <th className="px-3 py-2 text-right font-medium">전체</th>
                <th className="px-3 py-2 text-right font-medium">전날 대비</th>
                <th className="px-4 py-2 text-right font-medium sm:px-5">도서 목록</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // 🚨 '표의 아랫줄' 이 아니라 **바로 앞 기록**과 견줍니다.
                //    수집이 걸러진 날은 애초에 줄이 없습니다.
                const prev = rows[i + 1];
                const d = prev ? r.totalMb - prev.totalMb : null;
                return (
                  <tr key={r.measuredOn} className="border-b border-line-soft last:border-0">
                    <td className="whitespace-nowrap px-4 py-1.5 text-xs text-ink-soft sm:px-5">
                      {dayLabel(r.measuredOn)}
                    </td>
                    <td className="tnum px-3 py-1.5 text-right text-xs">
                      {r.totalMb.toFixed(0)}MB
                    </td>
                    <td
                      className={`tnum px-3 py-1.5 text-right text-xs ${
                        d === null
                          ? "text-ink-faint"
                          : d > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {d === null ? "—" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}MB`}
                    </td>
                    <td className="tnum px-4 py-1.5 text-right text-xs text-ink-soft sm:px-5">
                      {r.catalogMb === null ? "—" : `${r.catalogMb.toFixed(0)}MB`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line-soft px-4 py-2 text-2xs text-ink-faint sm:px-5">
          지운 자리는 바로 줄어들지 않습니다. 데이터베이스가 빈 자리로 두었다가
          다음 자료로 채웁니다. <strong>더 안 늘어나는 것</strong>이 정상입니다.
        </p>
      </Card>
    </div>
  );
}

function Head() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">저장 용량</h1>
      <p className="mt-1 text-sm text-ink-soft">
        매일 수집이 끝나면 자동으로 잽니다.
      </p>
    </div>
  );
}

function Line({
  name,
  mb,
  day,
  stop,
  unknown = false,
}: {
  name: string;
  mb: number | null;
  day: number | null;
  stop: string;
  unknown?: boolean;
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="px-4 py-2 text-xs sm:px-5">{name}</td>
      <td className="tnum px-3 py-2 text-right text-xs">
        {mb === null ? "—" : `${mb.toFixed(0)}MB`}
      </td>
      <td className="tnum px-3 py-2 text-right text-xs">
        {unknown || day === null ? (
          <span className="text-ink-faint">못 쟀음</span>
        ) : (
          `${day.toFixed(1)}MB`
        )}
      </td>
      <td className="px-4 py-2 text-left text-xs text-ink-faint sm:px-5">{stop}</td>
    </tr>
  );
}
