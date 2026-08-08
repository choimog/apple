"use client";

import type { RankingRow } from "@/lib/queries";
import { STORE_NAME } from "@/lib/supabase";
import { toCsv, downloadCsv, safeFileName } from "@/lib/csv";

/**
 * 순위표를 엑셀로 내려받기 (서점별 화면).
 *
 * CSV(쉼표로 구분된 표 파일) 로 저장합니다. 엑셀에서 바로 열립니다.
 * 한글 깨짐 방지·따옴표 처리는 lib/csv.ts 에서 함께 처리합니다.
 */
export default function ExportButton({
  rows,
  filename,
}: {
  rows: RankingRow[];
  filename: string;
}) {
  function download() {
    const csv = toCsv(
      [
        "순위",
        "등락",
        "서점",
        "제목",
        "저자",
        "출판사",
        "출간월",
        "판매지수",
        "ISBN13",
        "표지주소",
      ],
      rows.map((r) => [
        r.rank,
        r.isNew ? "NEW" : r.change === null ? "" : r.change,
        STORE_NAME[r.store_book.store_id] ?? "",
        r.store_book.raw_title,
        r.store_book.raw_author ?? "",
        r.store_book.raw_publisher ?? "",
        r.store_book.pub_ym ?? "",
        r.sales_point ?? "",
        r.store_book.isbn13 ?? "",
        r.store_book.cover_url ?? "",
      ])
    );

    downloadCsv(csv, safeFileName(filename));
  }

  return (
    <button
      onClick={download}
      disabled={!rows.length}
      className="rounded border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-ink-faint disabled:opacity-40"
    >
      ⬇ 엑셀로 받기
    </button>
  );
}
