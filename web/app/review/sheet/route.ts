/**
 * 매칭 검토 목록을 엑셀(CSV)로 내려받기 — 관리자만.
 *
 * 화면에서 하나씩 누르는 대신, 파일로 받아 한꺼번에 적고 올릴 수 있게 합니다.
 * 올리는 쪽은 /review/import 입니다.
 *
 * 【2026-08-10 대표님 신고 — 눌렀는데 한참 있다가 오류창이 떴다】
 * 파일이 커서가 아니었습니다. 아래 두 가지가 원인이었습니다.
 *
 *  1. 화면용 함수(20줄짜리)를 100번 불렀고, 그때마다 '몇 권 묶였나' 를
 *     처음부터 다시 셌습니다. 데이터베이스를 4,000번 넘게 부른 셈입니다.
 *     → lib/review.ts 의 streamReviewPairs 로 바꿨습니다. 약 50번이면 끝납니다.
 *
 *  2. 다 모은 **뒤에야** 보내기 시작했습니다. 그동안 브라우저에는 아무
 *     일도 안 일어나므로 '멈춘 것' 처럼 보입니다.
 *     → 이제 받는 대로 조금씩 흘려보냅니다. 누르자마자 내려받기가 뜹니다.
 *
 * ⚠️ 흘려보내기 시작하면 도중에 "실패했습니다" 라고 바꿀 수 없습니다.
 *    그래서 도중에 실패하면 **파일 안 마지막 줄에 적습니다.**
 *    잘린 파일을 다 받은 파일로 오해하시면 안 되니까요.
 */

import { NextResponse, type NextRequest } from "next/server";
import { CSV_BOM, csvLine } from "@/lib/csv";
import { currentRole } from "@/lib/supabase";
import { store } from "@/lib/stores";
import {
  isReviewTab,
  parseBand,
  parseSize,
  reasonText,
  streamReviewPairs,
  type ExportStatus,
  type ReviewPair,
  type ReviewTab,
} from "@/lib/review";
import { noteRow, SHEET_HEADER } from "@/lib/review-sheet";

/**
 * 이 요청에 쓸 수 있는 시간(초). 기본값은 10초라 큰 목록에서 잘립니다.
 * (무료 요금제에서는 60초가 최대입니다. 그보다 크게 적으면 무시됩니다)
 */
export const maxDuration = 60;

/** 미리 만들어 두지 말고 누를 때마다 새로 만듭니다 */
export const dynamic = "force-dynamic";

/** 한 번에 내려받을 수 있는 최대 줄 수 */
const MAX_ROWS = 2000;

function rowOf(p: ReviewPair): unknown[] {
  return [
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
  ];
}

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

  const status: ExportStatus = { sent: 0, capped: false };
  const batches = streamReviewPairs(tab, band, size, MAX_ROWS, status);

  // 🚨 첫 덩어리는 **흘려보내기 전에** 받아 봅니다.
  //    여기서 실패하면 아직 오류 화면을 띄울 수 있습니다.
  //    (한 번 보내기 시작하면 되돌릴 수 없습니다)
  let first: ReviewPair[] | null = null;
  try {
    const r = await batches.next();
    first = r.done ? [] : r.value;
  } catch (e) {
    return new NextResponse(
      "목록을 읽지 못했습니다.\n" +
        (e instanceof Error ? e.message : String(e)) +
        "\n\n아직 준비가 안 된 것이라면 Supabase 에서 db/auth.sql 을 실행해 주세요.",
      { status: 409 }
    );
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (line: string) => controller.enqueue(enc.encode(line + "\r\n"));
      try {
        controller.enqueue(enc.encode(CSV_BOM));
        push(csvLine([...SHEET_HEADER]));

        for (const p of first ?? []) push(csvLine(rowOf(p)));
        for await (const batch of batches) {
          for (const p of batch) push(csvLine(rowOf(p)));
        }

        if (status.sent === 0) {
          push(csvLine(noteRow("고르신 조건에 해당하는 짝이 없습니다.")));
        } else if (status.capped) {
          // ⚠️ 잘렸으면 **파일 안에 적습니다.** 조용히 자르면 "이게 전부" 로
          //    오해하십니다.
          push(
            csvLine(
              noteRow(
                `⚠️ 너무 많아 앞쪽 ${status.sent}건만 받았습니다. ` +
                  "이것부터 처리해서 올리시고 다시 받아 주세요."
              )
            )
          );
        }
      } catch (e) {
        // 도중에 실패했습니다. 이미 보낸 줄은 되돌릴 수 없으므로 **적어서 알립니다.**
        push(
          csvLine(
            noteRow(
              "⚠️ 받는 도중에 문제가 생겨 여기서 끊겼습니다. " +
                "이 파일은 전부가 아닙니다. 다시 받아 주세요. (" +
                (e instanceof Error ? e.message : String(e)) +
                ")"
            )
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  const name = `매칭검토_${tab}${band ? `_${band}점대` : ""}${
    size ? `_${size}` : ""
  }_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      // 중간에 끼어드는 서버가 통째로 모았다가 보내지 않도록
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
