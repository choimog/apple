import Link from "next/link";
import Cover from "@/components/Cover";
import { configError, STORE_COLOR, STORE_NAME } from "@/lib/supabase";
import { searchBooks } from "@/lib/queries";
import DataError from "@/components/DataError";

export const revalidate = 600;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (configError) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        {configError}
      </div>
    );
  }

  const { q = "" } = await searchParams;
  let results;
  try {
    results = q ? await searchBooks(q) : [];
  } catch (e) {
    return <DataError detail={String(e)} />;
  }

  return (
    <div className="space-y-5">
      <form
        action="/search"
        className="rounded-lg border border-slate-200 bg-white p-4"
      >
        <label
          htmlFor="q"
          className="mb-2 block text-sm font-semibold text-slate-700"
        >
          제목 · 저자 · 출판사로 찾기
        </label>
        <div className="flex gap-2">
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="예: 달러구트 / 히가시노 게이고 / 문학동네"
            className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            찾기
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          ※ 지금까지 수집된 베스트셀러 안에서만 찾습니다.
          한 번도 순위에 든 적 없는 책은 나오지 않습니다.
        </p>
      </form>

      {q && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">
            &ldquo;{q}&rdquo; 검색 결과 {results.length}건
          </h2>

          {results.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-500">
              찾는 책이 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {results.map((b) => (
                <li key={b.id} className="flex items-start gap-3 px-4 py-3">
                  <Cover url={b.cover_url} alt={b.raw_title} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          STORE_COLOR[b.store_id]
                        }`}
                      >
                        {STORE_NAME[b.store_id]}
                      </span>
                      {b.book_id ? (
                        <Link
                          href={`/book/${b.book_id}`}
                          className="font-medium hover:underline"
                        >
                          {b.raw_title}
                        </Link>
                      ) : (
                        <span className="font-medium">{b.raw_title}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">
                      {b.raw_author || "저자 정보 없음"}
                      {b.raw_publisher && ` · ${b.raw_publisher}`}
                      {b.pub_ym && ` · ${b.pub_ym}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
