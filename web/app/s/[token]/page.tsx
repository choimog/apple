import type { Metadata } from "next";
import Cover from "@/components/Cover";
import { Card } from "@/components/ui";
import { store } from "@/lib/stores";
import { num } from "@/lib/format";
import { getShareMeta, getShareRankings, SHARE_LIMIT } from "@/lib/share";

/**
 * 공유 링크로 열리는 화면 — **로그인 없이** 볼 수 있는 유일한 곳입니다.
 *
 * 【무엇을 보여주고, 무엇을 안 보여주나】
 * 그 분야의 순위표 하나만 보여줍니다. 위쪽 메뉴도, 다른 화면으로 가는
 * 링크도 없습니다. 이 주소를 받은 분이 사이트 전체를 둘러볼 수는 없습니다.
 *
 * 검색엔진에도 안 올라가게 막아 두었습니다 (아래 robots).
 */

export const metadata: Metadata = {
  title: "공유된 순위표",
  // 주소가 검색으로 새어 나가면 '아는 사람만' 이 아니게 됩니다.
  robots: { index: false, follow: false, nocache: true },
};

export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const meta = await getShareMeta(token);
  if (!meta) return <Gone />;

  const rows = await getShareRankings(token, SHARE_LIMIT);
  const s = store(meta.storeId);
  const period = meta.categoryKind === "weekly" ? "주간" : "일간";
  const where = meta.branchName || s.name;

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-2">
      <div>
        <p className="text-xs text-ink-faint">공유된 순위표</p>
        <h1 className="mt-0.5 text-xl font-bold tracking-[-0.01em]">
          {meta.label || `${where} ${meta.categoryName} ${period}`}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {meta.snapshotDate ? (
            <>
              <strong>{meta.snapshotDate}</strong> 기준 · 상위 {num(rows.length)}권
            </>
          ) : (
            "아직 수집된 자료가 없습니다"
          )}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card className="px-4 py-8 text-center text-sm text-ink-soft">
          아직 보여드릴 순위가 없습니다.
        </Card>
      ) : (
        <Card>
          <ol className="divide-y divide-line-soft">
            {rows.map((r) => (
              <li key={r.rank} className="flex items-center gap-3 px-4 py-3">
                <span className="tnum w-8 shrink-0 text-center text-sm font-bold">
                  {r.rank}
                </span>
                <Cover url={r.coverUrl} alt={r.title} className="h-16 w-11" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {[r.author, r.publisher, r.pubYm].filter(Boolean).join(" · ") || (
                      <span className="text-ink-faint">정보 없음</span>
                    )}
                  </p>
                </div>
                {/*
                  판매지수는 교보가 공개하지 않습니다.
                  없는 값을 0 으로 채우지 않고 아예 빼서 보여줍니다.
                */}
                {r.salesPoint !== null && (
                  <span className="tnum shrink-0 text-xs text-ink-soft">
                    {num(r.salesPoint)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <p className="text-xs leading-relaxed text-ink-faint">
        순위·판매지수의 저작권은 각 서점에 있습니다. 이 주소는 만든 사람이
        언제든 끌 수 있습니다.
      </p>
    </div>
  );
}

/**
 * 없는 주소 · 꺼진 링크 · 기한이 지난 링크 — 전부 같은 화면입니다.
 * 구분해서 알려주면 주소를 하나씩 넣어보며 있는지 알아낼 수 있습니다.
 */
function Gone() {
  return (
    <div className="mx-auto max-w-sm py-16 text-center">
      <p className="text-lg font-semibold">열 수 없는 주소입니다</p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        주소가 잘못됐거나, 만든 사람이 공유를 중단했거나, 기한이 지났습니다.
        <br />
        보내주신 분께 다시 문의해 주세요.
      </p>
    </div>
  );
}
