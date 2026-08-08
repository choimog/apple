import Link from "next/link";
import Cover from "@/components/Cover";
import DataError from "@/components/DataError";
import SetupNotice from "@/components/SetupNotice";
import {
  Card,
  CardHead,
  Empty,
  PageHead,
  StoreChip,
} from "@/components/ui";
import { configError } from "@/lib/supabase";
import { searchMerged } from "@/lib/queries-extra";
import { STORE_ORDER } from "@/lib/stores";
import { dayLabel } from "@/lib/format";

export const metadata = { title: "도서 검색" };

export const revalidate = 600;

const EXAMPLES = ["코스모스", "히가시노 게이고", "문학동네", "오디세이아"];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        {configError}
      </div>
    );
  }

  const { q = "" } = await searchParams;
  let result;
  try {
    result = await searchMerged(q);
  } catch (e) {
    return <DataError detail={String(e)} />;
  }
  const { rows, ok } = result;

  return (
    <div className="space-y-5">
      <PageHead
        eyebrow="찾기"
        title="도서 검색"
        lead={
          <>
            제목·저자·출판사로 찾습니다. <strong>같은 책은 한 줄로</strong> 나오고,
            어느 서점에 있는지는 옆의 배지로 표시합니다.
          </>
        }
      />

      {/* ---------- 검색창 ---------- */}
      <Card className="p-4 sm:p-5">
        <form action="/search" role="search">
          <label htmlFor="q" className="sr-only">
            제목·저자·출판사로 찾기
          </label>
          <div className="flex gap-2">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={q}
              autoComplete="off"
              placeholder="예: 코스모스 / 히가시노 게이고 / 문학동네"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
            >
              찾기
            </button>
          </div>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-2xs text-ink-faint">예시</span>
          {EXAMPLES.map((e) => (
            <Link
              key={e}
              href={`/search?q=${encodeURIComponent(e)}`}
              className="rounded-full border border-line px-2.5 py-0.5 text-2xs text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
            >
              {e}
            </Link>
          ))}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          ※ 지금까지 <strong>순위에 든 적 있는 책</strong> 안에서만 찾습니다.
          한 번도 베스트셀러에 오른 적 없는 책은 나오지 않습니다.
        </p>
      </Card>

      {!ok && (
        <SetupNotice what="검색은 데이터베이스가 계산해 주는 기능입니다. 아직 안 켜져 있어 결과를 만들 수 없습니다." />
      )}

      {/* ---------- 결과 ---------- */}
      {q && ok && (
        <Card>
          <CardHead
            title={
              <>
                &ldquo;{q}&rdquo; 검색 결과{" "}
                <span className="tnum font-normal text-ink-faint">{rows.length}종</span>
              </>
            }
            desc={
              rows.length >= 50
                ? "가장 관련 있는 50종만 보여줍니다. 더 좁혀서 찾아보세요."
                : undefined
            }
          />

          {rows.length === 0 ? (
            <Empty title="찾는 책이 없습니다">
              제목 일부만 넣어 보시거나, 저자·출판사 이름으로 다시 찾아보세요.
              <br />
              띄어쓰기가 서점 표기와 다르면 안 나올 수 있습니다.
            </Empty>
          ) : (
            <ul className="divide-y divide-line-soft">
              {rows.map((b) => (
                <li key={b.bookId} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <Cover url={b.coverUrl} alt={b.title} className="h-[72px] w-12" />

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/book/${b.bookId}`}
                      className="text-[15px] font-semibold leading-snug hover:underline"
                    >
                      {b.title}
                    </Link>

                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-soft">
                      {b.author ? (
                        <Link
                          href={`/author/${encodeURIComponent(b.author)}`}
                          className="hover:text-ink hover:underline"
                        >
                          {b.author}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">저자 정보 없음</span>
                      )}
                      {b.publisher && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <Link
                            href={`/publisher/${encodeURIComponent(b.publisher)}`}
                            className="hover:text-ink hover:underline"
                          >
                            {b.publisher}
                          </Link>
                        </>
                      )}
                      {b.pubYm && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span>{b.pubYm}</span>
                        </>
                      )}
                    </p>

                    {/* 어느 서점에 있는 책인지 — 줄을 나누지 않고 배지로 */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="flex gap-1">
                        {STORE_ORDER.map((sid) => (
                          <StoreChip
                            key={sid}
                            id={sid}
                            rank={b.stores.includes(sid) ? undefined : null}
                            size="sm"
                          />
                        ))}
                      </span>
                      {b.bestRank !== null && (
                        <span className="text-2xs text-ink-faint">
                          최고 <strong className="tnum text-ink-soft">{b.bestRank}위</strong>
                        </span>
                      )}
                      {b.lastSeen && (
                        <span className="text-2xs text-ink-faint">
                          최근 순위 {dayLabel(b.lastSeen)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {q && ok && rows.length > 0 && (
        <p className="px-1 text-xs leading-relaxed text-ink-faint">
          ※ 회색 배지는 그 서점 순위에 <strong>든 적이 없다</strong>는 뜻입니다.
          그 서점에서 안 판다는 뜻이 아닙니다 — 저희는 베스트셀러 목록만 모으기
          때문에, 순위에 못 든 책은 알 수 없습니다.
        </p>
      )}
    </div>
  );
}
