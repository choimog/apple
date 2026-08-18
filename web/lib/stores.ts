/**
 * 서점 정보를 한 곳에 모읍니다.
 *
 * 예전에는 화면마다 `STORE_NAME[1]`, `new Set([2,3])` 같은 값을 따로 적어
 * 뒀습니다. 한 군데를 고치면 다른 데가 어긋나기 좋은 구조였습니다.
 */

export type StoreId = 1 | 2 | 3;

export type StoreMeta = {
  id: StoreId;
  name: string;
  short: string;
  /** 판매지수를 공개하는가 (교보는 공개하지 않습니다) */
  hasSalesPoint: boolean;
  /** 그 서점이 판매지수를 부르는 이름 */
  salesLabel: string;
  /** 배지 배경/글자 (밝은·어두운 화면 모두에서 읽히도록 투명도로 처리) */
  chip: string;
  /** 선·점 등 그래프에 쓰는 색 (CSS 변수) */
  color: string;
};

export const STORES: Record<StoreId, StoreMeta> = {
  1: {
    id: 1,
    name: "교보문고",
    short: "교보",
    hasSalesPoint: false,
    salesLabel: "판매지수",
    chip: "bg-kyobo/10 text-kyobo ring-1 ring-kyobo/25",
    color: "var(--store-kyobo)",
  },
  2: {
    id: 2,
    name: "예스24",
    short: "예스",
    hasSalesPoint: true,
    salesLabel: "판매지수",
    chip: "bg-yes24/10 text-yes24 ring-1 ring-yes24/25",
    color: "var(--store-yes24)",
  },
  3: {
    id: 3,
    name: "알라딘",
    short: "알라딘",
    hasSalesPoint: true,
    salesLabel: "세일즈포인트",
    chip: "bg-aladin/10 text-aladin ring-1 ring-aladin/25",
    color: "var(--store-aladin)",
  },
};

/** 화면에 보여주는 순서: 교보 → 예스24 → 알라딘 */
export const STORE_ORDER: StoreId[] = [1, 2, 3];

/**
 * 서점 상품 페이지 주소.
 *
 * 【2026-08-18 대표님 질문 — "용량이 많이 추가될까?"】
 * 한 글자도 안 늘어납니다. 주소를 저장하는 게 아니라, 이미 갖고 있는
 * **서점 상품번호(store_book_key)로 그때그때 만들어** 씁니다.
 * 그 번호는 목록을 걷을 때부터 저장하고 있었습니다.
 *
 * ⚠️ 이건 '상세 페이지에 들어가지 않는다' 는 규칙과 어긋나지 않습니다.
 *    그 규칙은 **우리가 긁어오는 것**을 막는 것이고, 이건 대표님이
 *    누르셨을 때 브라우저가 여는 것입니다. 우리는 아무것도 안 받아옵니다.
 */
export function storeUrl(id: number, key: string | null | undefined): string | null {
  const k = (key ?? "").trim();
  if (!k) return null;
  if (id === 1) return `https://product.kyobobook.co.kr/detail/${k}`;
  if (id === 2) return `https://www.yes24.com/product/goods/${k}`;
  if (id === 3) return `https://www.aladin.co.kr/shop/wproduct.aspx?ItemId=${k}`;
  return null;
}

export function store(id: number): StoreMeta {
  return STORES[id as StoreId] ?? STORES[1];
}

/** 예전 코드가 쓰던 이름들 (조금씩 남아 있어 유지합니다) */
export const STORE_NAME: Record<number, string> = {
  1: STORES[1].name,
  2: STORES[2].name,
  3: STORES[3].name,
};
