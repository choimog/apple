/**
 * 공유 링크 — 로그인 없이 순위표 하나만 보여주기.
 *
 * 【왜 함수(RPC)로만 읽나요?】
 * db/auth.sql 로 잠근 뒤에는 로그인 안 한 사람은 표를 하나도 못 읽습니다.
 * 그래서 "이 주소를 가진 사람에게만, 이 분야만" 을 열어주는 문을 따로
 * 냈습니다. 그 문이 db/share.sql 의 함수들입니다.
 *
 * 표를 직접 읽지 않는 것이 요점입니다. 함수가 주소값을 먼저 확인하고,
 * 통과한 것만 그 분야의 줄을 돌려줍니다.
 */

import { db } from "./supabase";

export type ShareMeta = {
  kind: string;
  label: string | null;
  categoryId: number;
  categoryName: string;
  branchName: string;
  storeId: number;
  categoryKind: string;
  snapshotDate: string | null;
};

export type ShareRow = {
  rank: number;
  salesPoint: number | null;
  title: string;
  author: string | null;
  publisher: string | null;
  pubYm: string | null;
  coverUrl: string | null;
  storeId: number;
};

/** 화면 하나에 보여줄 최대 줄 수 (데이터베이스 쪽 상한은 300) */
export const SHARE_LIMIT = 100;

/**
 * 주소값으로 무엇을 보여줄지 알아냅니다.
 * 없는 주소값·꺼진 링크·기한 지난 링크는 전부 똑같이 null 입니다.
 * (구분해 주면 주소값을 하나씩 넣어보며 있는지 알아낼 수 있습니다)
 */
export async function getShareMeta(token: string): Promise<ShareMeta | null> {
  const { data, error } = await db().rpc("share_meta", { p_token: token });
  if (error || !data?.length) return null;
  const r = data[0] as Record<string, unknown>;
  return {
    kind: String(r.kind),
    label: (r.label as string) ?? null,
    categoryId: Number(r.category_id),
    categoryName: String(r.category_name ?? ""),
    branchName: String(r.branch_name ?? ""),
    storeId: Number(r.store_id),
    categoryKind: String(r.kcategory_kind ?? ""),
    snapshotDate: (r.snapshot_date as string) ?? null,
  };
}

export async function getShareRankings(
  token: string,
  limit = SHARE_LIMIT
): Promise<ShareRow[]> {
  const { data, error } = await db().rpc("share_rankings", {
    p_token: token,
    p_limit: limit,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    rank: Number(r.rank),
    salesPoint: r.sales_point === null ? null : Number(r.sales_point),
    title: String(r.raw_title ?? ""),
    author: (r.raw_author as string) ?? null,
    publisher: (r.raw_publisher as string) ?? null,
    pubYm: (r.pub_ym as string) ?? null,
    coverUrl: (r.cover_url as string) ?? null,
    storeId: Number(r.store_id),
  }));
}

/* ------------------------------------------------------------------ */
/*  관리자용                                                            */
/* ------------------------------------------------------------------ */

export type ShareLink = {
  token: string;
  kind: string;
  targetId: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  expiresAt: string | null;
  /** 만든 사람 (관리자에게만 보입니다. 회원끼리는 서로 안 보입니다) */
  ownerEmail: string | null;
  /** 내가 만든 것인지 */
  isMine: boolean;
};

/**
 * 링크 목록.
 *
 * 회원은 **자기가 만든 것만**, 관리자는 전부 봅니다.
 * 그 판단은 데이터베이스(my_share_links)가 합니다 — 화면 쪽 확인만
 * 믿으면, 화면 코드에서 조건 하나만 빠져도 남의 링크가 보입니다.
 */
export async function listShareLinks(): Promise<{
  rows: ShareLink[];
  ok: boolean;
  /** 안 될 때 데이터베이스가 실제로 한 말 */
  error?: string;
}> {
  const { data, error } = await db().rpc("my_share_links");
  if (error) {
    // ⚠️ 예전에는 여기서 이유를 버리고 화면에 "db/share.sql 을 실행하세요"
    //    라고만 적었습니다. 대표님이 db/share-open.sql 을 실행하신 뒤에도
    //    똑같은 문구가 떠서, 무엇이 문제인지 알 길이 없었습니다 (2026-08-10).
    //    이유를 버리지 말고 그대로 들고 나갑니다.
    return { rows: [], ok: false, error: error.message };
  }
  return {
    rows: (data ?? []).map((r: Record<string, unknown>) => ({
      token: String(r.token),
      kind: String(r.kind),
      targetId: String(r.target_id),
      label: (r.label as string) ?? null,
      enabled: Boolean(r.enabled),
      createdAt: String(r.created_at),
      expiresAt: (r.expires_at as string) ?? null,
      // 아직 db/share-open.sql 을 실행하지 않았으면 이 칸들이 없습니다.
      // 없으면 '모름' 으로 두고 화면에서 감춥니다 (지어내지 않습니다).
      ownerEmail: (r.owner_email as string) ?? null,
      isMine: r.is_mine === undefined ? true : Boolean(r.is_mine),
    })),
    ok: true,
  };
}

/** 링크 만들기. 성공하면 주소값, 실패하면 사람이 읽을 수 있는 이유. */
export async function createShareLink(
  categoryId: number,
  label: string,
  days: number | null
): Promise<{ token?: string; error?: string }> {
  const { data, error } = await db().rpc("create_share_link", {
    p_kind: "ranking",
    p_target_id: String(categoryId),
    p_label: label || null,
    p_days: days,
  });
  if (error) return { error: readable(error.message) };
  if (!data) return { error: "주소를 만들지 못했습니다." };
  return { token: String(data) };
}

export async function setShareLink(
  token: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db().rpc("set_share_link", {
    p_token: token,
    p_enabled: enabled,
  });
  if (error) return { ok: false, error: readable(error.message) };
  // 데이터베이스가 false 를 돌려주면 '그런 링크가 없다' 는 뜻입니다.
  // 오류가 없다고 성공으로 치면 안 됩니다.
  if (data === false) return { ok: false, error: "그런 링크가 없습니다." };
  return { ok: true };
}

function readable(message: string): string {
  if (/관리자만/.test(message)) return "관리자만 할 수 있습니다.";
  if (/function|does not exist|schema cache/i.test(message)) {
    return "아직 준비가 안 됐습니다. Supabase 에서 db/share.sql 을 실행해 주세요.";
  }
  return `실패했습니다: ${message}`;
}
