import BookRow from "@/components/BookRow";
import DataError from "@/components/DataError";
import DatePicker from "@/components/DatePicker";
import {
  Card,
  CardHead,
  Empty,
  FieldLabel,
  PeriodSwitch,
  Pill,
} from "@/components/ui";
import { configError, currentRole } from "@/lib/supabase";
import { defaultDepth, getSnapshotDates, type Period } from "@/lib/queries";
import { favoriteRows, myFavorites, relinkFavorites } from "@/lib/favorites";
import { dayLabel } from "@/lib/format";

export const metadata = { title: "즐겨찾기" };

/**
 * 즐겨찾기 — 담아 두신 책만 모아, 종합 화면과 같은 모양으로.
 *
 * 【2026-08-18 대표님 요청】
 *   "즐겨찾기한 도서는 종합탭에 있는 것처럼, 내가 선택한 도서들의 3사
 *    자료가 보이게끔. 그리고 즐겨찾기 목록에 있는 도서가 장기간 업데이트가
 *    안 돼서 지워질 경우, 그 이용자에게 매일 어떤 도서가 지워졌다고
 *    안내문 정도만 남길 수 있나?"
 *
 * 🚨 【담아 두신 책은 순위가 없어도 목록에 남습니다】
 * 종합 화면은 '순위에 오른 책' 을 보여주는 곳이라 순위가 없으면 아예 안
 * 나옵니다. 여기는 반대입니다. 담아 두신 책이 어느 날 목록에서 사라지면
 * "내가 뺐나?" 하고 헷갈리시게 됩니다. 순위가 없으면 **없다고 적습니다.**
 */
export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string; basis?: string; fav?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }
  if ((await currentRole()) === null) {
    return (
      <Card className="p-6">
        <p className="text-sm text-ink-soft">로그인하시면 즐겨찾기를 쓰실 수 있습니다.</p>
      </Card>
    );
  }

  const params = await searchParams;

  // 🚨 먼저 '번호만 바뀐 책' 을 다시 이어 줍니다. 이게 없으면 [도서 매칭]
  //    이 돌 때마다 멀쩡한 책이 '사라졌다' 고 뜹니다 (lib/favorites.ts).
  await relinkFavorites();

  const { rows: favs, needsSql, ok } = await myFavorites();

  if (needsSql) {
    return (
      <div className="space-y-5">
        <Head />
        <Card>
          <Empty title="아직 준비가 안 됐습니다">
            Supabase 에서{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">db/favorites.sql</code>{" "}
            을 한 번 실행해 주세요. 그러면 바로 쓰실 수 있습니다.
          </Empty>
        </Card>
      </div>
    );
  }
  if (!ok) return <DataError detail="즐겨찾기를 읽지 못했습니다." />;

  const alive = favs.filter((f) => f.bookId !== null);
  const gone = favs.filter((f) => f.bookId === null);
  const unseen = gone.filter((f) => f.noticedAt === null);

  let dates: string[] = [];
  try {
    dates = await getSnapshotDates(400);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  const period: Period = params.period === "weekly" ? "weekly" : "daily";
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  // 기준: 종합('all') 또는 분야 상위('*')
  const basis = params.basis === "top" ? "*" : "all";
  const depth = defaultDepth(period);

  const { rows, ok: rowsOk } =
    date && alive.length
      ? await favoriteRows(
          alive.map((f) => f.bookId as number),
          date,
          period,
          basis,
          depth
        )
      : { rows: [], ok: true };

  const href = (over: Record<string, string>) =>
    `/favorites?${new URLSearchParams({
      period,
      date: date ?? "",
      basis: basis === "*" ? "top" : "all",
      ...over,
    }).toString()}`;

  return (
    <div className="space-y-5">
      <Head />

      {/* ---------- 🚨 사라진 책 안내 ---------- */}
      {unseen.length > 0 && (
        <div
          role="alert"
          className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300 sm:px-5"
        >
          <p className="font-semibold">
            담아 두신 책 {unseen.length}권이 자료에서 사라졌습니다
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs leading-relaxed">
            {unseen.slice(0, 10).map((f) => (
              <li key={f.id}>
                · {f.title}
                {f.author && <span className="opacity-80"> / {f.author}</span>}
              </li>
            ))}
            {unseen.length > 10 && <li>· 외 {unseen.length - 10}권</li>}
          </ul>
          <p className="mt-2 text-xs opacity-90">
            14일 동안 세 서점 어디에도 올라오지 않아 자료가 정리된 것입니다.
            책이 다시 순위에 오르면 새로 담으실 수 있습니다.
          </p>
          <form action="/favorites/action" method="post" className="mt-2">
            <input type="hidden" name="do" value="noticed" />
            <input type="hidden" name="back" value="/favorites" />
            <button
              type="submit"
              className="rounded-lg border border-amber-400/70 px-3 py-1 text-xs font-semibold hover:bg-amber-500/10"
            >
              확인했습니다
            </button>
          </form>
        </div>
      )}

      {/* ---------- 고르기 ---------- */}
      {alive.length > 0 && date && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <FieldLabel>기간</FieldLabel>
              <PeriodSwitch period={period} hrefFor={(p) => href({ period: p })} />
            </div>
            <div>
              <FieldLabel>기준</FieldLabel>
              <div className="flex gap-1.5">
                <Pill
                  href={href({ basis: "all" })}
                  active={basis === "all"}
                  title="종합 목록에서의 순위 — 종합 화면과 같은 잣대입니다"
                >
                  종합
                </Pill>
                <Pill
                  href={href({ basis: "top" })}
                  active={basis === "*"}
                  title="그날 올라 있는 분야 중 가장 높은 순위. 날마다 다른 분야를 가리킬 수 있습니다"
                >
                  분야 상위
                </Pill>
              </div>
            </div>
            <div>
              <FieldLabel>날짜</FieldLabel>
              <DatePicker
                dates={dates}
                value={date}
                basePath="/favorites"
                query={{ period, basis: basis === "*" ? "top" : "all" }}
              />
            </div>
          </div>
        </Card>
      )}

      {/* ---------- 목록 ---------- */}
      <Card>
        <CardHead
          title={`담아 두신 책 ${alive.length}권`}
          desc={
            date
              ? `${dayLabel(date)} 기준 · ${
                  basis === "all" ? "종합 순위" : "분야 상위 순위"
                }`
              : "아직 수집된 순위가 없습니다"
          }
        />
        {!alive.length ? (
          <Empty title="아직 담아 두신 책이 없습니다">
            도서 상세 화면 오른쪽 위의 <strong>☆ 즐겨찾기</strong> 를 누르시면
            여기에 모입니다.
          </Empty>
        ) : !rowsOk ? (
          <Empty title="순위를 읽지 못했습니다">
            Supabase 에서{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5">db/favorites.sql</code>{" "}
            을 실행하셨는지 확인해 주세요.
          </Empty>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r, i) => (
              <BookRow
                key={r.bookId}
                row={r}
                position={i + 1}
                depth={depth}
                action={
                  <form action="/favorites/action" method="post">
                    <input type="hidden" name="do" value="remove" />
                    <input type="hidden" name="book" value={r.bookId} />
                    <input type="hidden" name="back" value="/favorites" />
                    <button
                      type="submit"
                      title="즐겨찾기에서 뺍니다"
                      className="rounded-lg border border-line px-2 py-1 text-xs text-ink-faint hover:bg-surface-2 hover:text-ink"
                    >
                      빼기
                    </button>
                  </form>
                }
              />
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- 사라진 책 ---------- */}
      {gone.length > 0 && (
        <Card>
          <CardHead
            title={`사라진 책 ${gone.length}권`}
            desc="14일 동안 세 서점 어디에도 안 올라와 자료가 정리되었습니다"
          />
          <ul className="divide-y divide-line-soft">
            {gone.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{f.title}</p>
                  <p className="truncate text-xs text-ink-faint">
                    {[f.author, f.publisher].filter(Boolean).join(" · ") || "정보 없음"}
                    {f.removedAt && ` · ${dayLabel(f.removedAt.slice(0, 10))}`}
                  </p>
                </div>
                <form action="/favorites/action" method="post" className="shrink-0">
                  <input type="hidden" name="do" value="forget" />
                  <input type="hidden" name="id" value={f.id} />
                  <input type="hidden" name="back" value="/favorites" />
                  <button
                    type="submit"
                    className="rounded-lg border border-line px-2 py-1 text-xs text-ink-faint hover:bg-surface-2 hover:text-ink"
                  >
                    목록에서 빼기
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Head() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">즐겨찾기</h1>
      <p className="mt-1 text-sm text-ink-soft">
        담아 두신 책의 3사 순위를 한눈에. 다른 회원에게는 안 보입니다.
      </p>
    </div>
  );
}
