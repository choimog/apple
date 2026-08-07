"use client";

import type { RankingRow } from "@/lib/queries";
import { STORE_NAME } from "@/lib/supabase";

/**
 * 엑셀로 내려받기.
 *
 * CSV(쉼표로 구분된 표 파일) 로 저장합니다. 엑셀에서 바로 열립니다.
 * 한글이 깨지지 않도록 파일 맨 앞에 BOM 이라는 표시를 붙입니다.
 * (이게 없으면 엑셀에서 한글이 ????? 로 보입니다)
 */
export default function ExportButton({
  rows,
  filename,
}: {
  rows: RankingRow[];
  filename: string;
}) {
  function download() {
    const header = [
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
    ];

    const lines = rows.map((r) => [
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
    ]);

    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const csv =
      "﻿" +
      [header, ...lines].map((row) => row.map(escape).join(",")).join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      disabled={!rows.length}
      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 disabled:opacity-40"
    >
      ⬇ 엑셀로 받기
    </button>
  );
}
