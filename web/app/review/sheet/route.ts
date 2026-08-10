/**
 * 매칭 검토 목록을 엑셀(CSV)로 내려받기 — 관리자만.
 *
 * 화면에서 하나씩 누르는 대신, 파일로 받아 한꺼번에 적고 올릴 수 있게 합니다.
 * 올리는 쪽은 /review/import 입니다.
 */

import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/csv";
import { currentRole } from "@/lib/supabase";
import { store } from "@/lib/stores";
import {
  getReviewPairs,
  isReviewTab,
  parseBand,
  parseSize,
  reasonText,
  type ReviewTab,
} from "@/lib/review";
import { SHEET_HEADER } from "@/lib/review-sheet";

/** 한 번에 내려받을 수 있는 최대 줄 수 */
const MAX_ROWS = 2000;
const PER_PAGE = 20;

export async function GET(request: NextRequest) {
  if ((await currentRole()) !== "admin") {
    return new NextResponse("관리자만 내려받을 수 있습니다.", { status: 403 });
  }

  const q = request.nextUrl.searchParams;
  const tab: ReviewTab = isReviewTab(q.get("tab") ?? undefined)
    ? (q.get("tab") as ReviewTab)
    : "pending";
  const band = parseBand(q.get("band") ?? undefined);
  const size = parseSize(q.get("size") ?? undefined);

  // getReviewPairs 는 20개씩 돌려주므로 여러 번 불러 모읍니다.
  const rows: unknown[][] = [];
  let capped = false;
  for (let page = 0; rows.length < MAX_ROWS; page++) {
    const res = await getReviewPairs(tab, page, band, size);
    if (!res.ok) {
      return new NextResponse(
        "아직 준비가 안 됐습니다. Supabase 에서 db/auth.sql 을 실행해 주세요.",
        { status: 409 }
      );
    }
    if (!res.rows.length) break;

    for (const p of res.rows) {
      rows.push([
        p.id,
        "", // ← 대표님이 채우실 칸
        p.score,
        p.groupSize ?? "",
        store(p.a.storeId).name,
        p.a.title,
        p.a.author ?? "",
        p.a.publisher ?? "",
        p.a.pubYm ?? "",
        store(p.b.storeId).name,
        p.b.title,
        p.b.author ?? "",
        p.b.publisher ?? "",
        p.b.pubYm ?? "",
        reasonText(p.reasons).map((r) => r.label).join(" · "),
      ]);
    }
    if (res.rows.length < PER_PAGE) break;
    if (rows.length >= MAX_ROWS) {
      capped = true;
      break;
    }
  }

  // ⚠️ 잘렸으면 **파일 안에 적습니다.** 조용히 자르면 "이게 전부" 로 오해합니다.
  if (capped) {
    rows.push([
      "",
      "",
      "",
      "",
      "",
      `⚠️ 너무 많아 앞쪽 ${MAX_ROWS}건만 받았습니다. 이것부터 처리하시고 다시 받아 주세요.`,
      "", "", "", "", "", "", "", "", "",
    ]);
  }

  const name = `매칭검토_${tab}${band ? `_${band}점대` : ""}${
    size ? `_${size}` : ""
  }_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(toCsv([...SHEET_HEADER], rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
