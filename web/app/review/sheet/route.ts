/**
 * 매칭 검토 목록을 엑셀(CSV)로 내려받기 — 관리자만.
 *
 * 화면에서 하나씩 누르는 대신, 파일로 받아 한꺼번에 적고 올릴 수 있게 합니다.
 * 올리는 쪽은 /review/import 입니다.
 *
 * 【2026-08-10 대표님 신고 — 눌렀는데 한참 있다가 오류창이 떴다】
 * 파일이 커서가 아니었습니다. 화면용 함수(20줄짜리)를 100번 불렀고,
 * 그때마다 '몇 권 묶였나' 를 처음부터 다시 셌습니다. 데이터베이스를
 * 4,000번 넘게 부른 셈이라 서버의 시간 제한에 걸렸습니다.
 *   → lib/review.ts 의 streamReviewPairs 로 바꿨습니다 (약 50번).
 *   → 다 모은 뒤에 보내지 않고 받는 대로 흘려보냅니다.
 *
 * 【2026-08-10 대표님 요청 — 세 가지를 갯수 제한 없이 한 번에】
 * "검토 대기와 자동으로 묶은 것, 내가 내린 결정까지 갯수 제한 없이
 *  한번에 다 다운로드 할 수 있게 해줬으면 좋겠어. 한번에 정리할 수 있게."
 *   → tab=all 이면 세 가지를 이어서 한 파일에 담습니다.
 *   → 줄 수 제한을 없앴습니다.
 *
 * ⚠️ 흘려보내기 시작하면 도중에 "실패했습니다" 라고 바꿀 수 없습니다.
 *    그래서 **파일 맨 끝에 '여기까지가 전부입니다' 를 적습니다.**
 *    그 줄이 없으면 중간에 끊긴 것입니다. 잘린 파일을 다 받은 파일로
 *    오해하시면 안 되니까요.
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
  TAB_LABEL,
  type ExportStatus,
  type ReviewPair,
  type ReviewTab,
} from "@/lib/review";
import { noteRow, SHEET_HEADER } from "@/lib/review-sheet";

/** 시간이 오래 걸릴 수 있습니다 (무료 요금제 최대치) */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** 한 탭만 받을 때의 줄 수 상한. 0 이면 제한 없음 */
const ONE_TAB_MAX = 2000;

const ALL_TABS: ReviewTab[] = ["pending", "merged", "mine"];

function rowOf(p: ReviewPair, tab: ReviewTab): unknown[] {
  return [
    p.id,
    "", // ← 대표님이 채우실 칸
    TAB_LABEL[tab],
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
  const raw = q.get("tab") ?? undefined;

  // tab=all → 세 가지 전부, 갯수 제한 없음
  const all = raw === "all";
  const tabs: ReviewTab[] = all
    ? ALL_TABS
    : [isReviewTab(raw) ? (raw as ReviewTab) : "pending"];

  // 전체 받기는 조건을 걸지 않습니다 — '한 번에 정리' 가 목적이니까요
  const band = all ? null : parseBand(q.get("band") ?? undefined);
  const size = all ? null : parseSize(q.get("size") ?? undefined);
  const maxRows = all ? Infinity : ONE_TAB_MAX;
  // 화면에서 찾아 놓고 받으면 **찾은 것만** 담습니다.
  // 파일이 화면과 다르면 그 파일이 무엇인지 알 수 없습니다.
  const find = all ? "" : (q.get("q") ?? "").trim().slice(0, 60);

  // 🚨 첫 덩어리는 **흘려보내기 전에** 받아 봅니다.
  //    여기서 실패하면 아직 오류 화면을 띄울 수 있습니다.
  const firstStatus: ExportStatus = { sent: 0, capped: false };
  const firstGen = streamReviewPairs(tabs[0], band, size, maxRows, firstStatus, find);
  let first: ReviewPair[];
  try {
    const r = await firstGen.next();
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
      let total = 0;
      let capped = false;

      try {
        controller.enqueue(enc.encode(CSV_BOM));
        push(csvLine([...SHEET_HEADER]));

        for (const [i, tab] of tabs.entries()) {
          // 첫 탭의 첫 덩어리는 위에서 이미 받아 두었습니다
          const status = i === 0 ? firstStatus : { sent: 0, capped: false };
          const gen =
            i === 0
              ? firstGen
              : streamReviewPairs(tab, band, size, maxRows, status, find);

          if (all) push(csvLine(noteRow(`──── ${TAB_LABEL[tab]} ────`)));
          if (i === 0) for (const p of first) push(csvLine(rowOf(p, tab)));
          for await (const batch of gen) {
            for (const p of batch) push(csvLine(rowOf(p, tab)));
          }

          total += status.sent;
          if (status.capped) capped = true;
          if (all && status.sent === 0) {
            push(csvLine(noteRow("(이 칸에는 없습니다)")));
          }
        }

        if (total === 0) {
          push(csvLine(noteRow("고르신 조건에 해당하는 짝이 없습니다.")));
        }
        if (capped) {
          push(
            csvLine(
              noteRow(
                `⚠️ 너무 많아 앞쪽 ${total}건까지만 담았습니다. ` +
                  "이것부터 처리해서 올리시고 다시 받아 주세요."
              )
            )
          );
        }

        // 🚨 이 줄이 파일 끝에 있어야 **다 받은 것**입니다.
        push(csvLine(noteRow(`✅ 여기까지가 전부입니다 (총 ${total}건)`)));
      } catch (e) {
        // 도중에 실패했습니다. 이미 보낸 줄은 되돌릴 수 없으므로 적어서 알립니다.
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

  const today = new Date().toISOString().slice(0, 10);
  const name = all
    ? `매칭검토_전체_${today}.csv`
    : `매칭검토_${tabs[0]}${band ? `_${band}점대` : ""}${
        size ? `_${size}` : ""
      }${find ? `_검색_${find}` : ""}_${today}.csv`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
