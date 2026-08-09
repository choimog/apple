"use client";

/**
 * 한 도서의 순위·판매지수 이력을 엑셀로 내려받기.
 *
 * 【2026-08-08 대표님 요청】
 * "도서 페이지에서도 엑셀로 받기를 누르면, 그 도서의 판매지수와 순위를
 *  데이터로 쭉 받아볼 수 있었으면 좋겠어."
 *
 * 한 줄 = 하루 × 서점 × 집계기간 입니다.
 * 예) 8월 8일 교보 일간 / 8월 8일 교보 주간 / 8월 8일 예스24 일간 …
 *
 * 화면의 그래프와 똑같은 값을 씁니다. 그래프에는 한 서점당 한 줄만
 * 그리므로(여러 분야에 올라 있으면 가장 높은 순위), 여기서도 같은 기준을
 * 씁니다. 그래야 그래프와 엑셀이 어긋나지 않습니다.
 * 그 순위가 어느 분야에서 나온 것인지는 '분야' 칸에 적어 둡니다.
 *
 * ⚠️ 없는 값은 비워 둡니다. 0 이나 추정치를 넣지 않습니다.
 *    (교보문고는 판매지수를 아예 공개하지 않습니다)
 */

import { store } from "@/lib/stores";
import { PERIOD_LABEL } from "@/lib/period";
import type { HistoryPoint } from "@/lib/queries";
import { toCsv, downloadCsv, safeFileName } from "@/lib/csv";

export default function BookExportButton({
  history,
  title,
  author,
  publisher,
}: {
  history: HistoryPoint[];
  title: string;
  author: string | null;
  publisher: string | null;
}) {
  function download() {
    // 날짜 오름차순 → 서점 → 기간. 엑셀에서 바로 그래프를 그릴 수 있는 차례입니다.
    const rows = [...history].sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.storeId - b.storeId ||
        a.period.localeCompare(b.period)
    );

    const csv = toCsv(
      ["날짜", "서점", "집계기간", "분야", "순위", "판매지수", "제목", "저자", "출판사"],
      rows.map((h) => [
        h.date,
        store(h.storeId).name,
        PERIOD_LABEL[h.period],
        h.categoryName,
        h.rank,
        // 교보는 판매지수를 공개하지 않습니다 → 빈 칸
        h.sales ?? "",
        title,
        author ?? "",
        publisher ?? "",
      ])
    );

    downloadCsv(csv, safeFileName(`${title}_순위이력`));
  }

  return (
    <button
      onClick={download}
      disabled={!history.length}
      title={
        history.length
          ? `${history.length}줄 (날짜 × 서점 × 집계기간)`
          : "아직 순위 기록이 없습니다"
      }
      className="shrink-0 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-40"
    >
      ⬇ 엑셀로 받기
    </button>
  );
}
