/**
 * 전체 내려받기의 '한 조각' — 관리자만.
 *
 * 브라우저가 이 주소를 여러 번 불러서 500줄씩 가져갑니다.
 * 한 번은 1초도 안 걸리므로 서버의 60초 제한에 걸리지 않습니다.
 * (한 번에 다 만들려다 29,502줄·36,002줄에서 두 번 잘렸습니다)
 *
 * 부르는 쪽: web/components/ExportAll.tsx
 */

import { NextResponse, type NextRequest } from "next/server";
import { currentRole } from "@/lib/supabase";
import { store } from "@/lib/stores";
import {
  getExportChunk,
  isReviewTab,
  reasonText,
  TAB_LABEL,
  type ReviewTab,
} from "@/lib/review";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** 한 번에 가져가는 줄 수 */
const LIMIT = 500;

export async function GET(request: NextRequest) {
  if ((await currentRole()) !== "admin") {
    return NextResponse.json({ error: "관리자만 내려받을 수 있습니다." }, { status: 403 });
  }

  const q = request.nextUrl.searchParams;
  const raw = q.get("tab") ?? "";
  if (!isReviewTab(raw)) {
    return NextResponse.json({ error: `모르는 칸: ${raw}` }, { status: 400 });
  }
  const tab = raw as ReviewTab;
  const after = Number(q.get("after") ?? 0);
  if (!Number.isInteger(after) || after < 0) {
    return NextResponse.json({ error: "이어받을 번호가 이상합니다." }, { status: 400 });
  }

  try {
    const { rows, next } = await getExportChunk(tab, after, LIMIT);
    return NextResponse.json({
      rows: rows.map((p) => [
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
        p.a.listPrice ?? "",
        store(p.b.storeId).name,
        p.b.title,
        p.b.author ?? "",
        p.b.publisher ?? "",
        p.b.pubYm ?? "",
        p.b.listPrice ?? "",
        reasonText(p.reasons).map((r) => r.label).join(" · "),
      ]),
      next,
    });
  } catch (e) {
    // 🚨 조용히 빈 조각을 돌려주면 브라우저는 '다 끝났다' 고 믿습니다.
    //    그러면 잘린 파일이 완성본인 척 저장됩니다. 반드시 실패로 알립니다.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
