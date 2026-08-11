-- ============================================================================
--  서점 베스트셀러 통합 트래킹 — 데이터베이스 스키마
-- ============================================================================
--
--  【이 파일을 어떻게 쓰나요?】
--  1. Supabase 대시보드(https://supabase.com/dashboard) 접속
--  2. 왼쪽 메뉴에서 [SQL Editor] 클릭
--  3. [New query] 클릭
--  4. 이 파일 전체를 복사해서 붙여넣고 [Run] 클릭
--  → 아래의 모든 표(테이블)가 한 번에 만들어집니다.
--
--  ※ 이 파일은 여러 번 실행해도 안전합니다 (IF NOT EXISTS 사용).
--  ※ 이미 데이터가 들어있는 상태에서 다시 실행해도 데이터는 지워지지 않습니다.
-- ============================================================================


-- ============================================================================
--  0. 확장 기능 켜기
-- ============================================================================
--  pg_trgm: 한글 제목/출판사를 "부분 일치"로 빠르게 검색하기 위한 기능입니다.
--  (예: '문학동네'로 검색했을 때 '(주)문학동네'도 찾아줌)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ============================================================================
--  1. stores — 서점 목록 (교보/예스24/알라딘, 3개 고정)
-- ============================================================================
CREATE TABLE IF NOT EXISTS stores (
    id          smallint     PRIMARY KEY,
    code        text         NOT NULL UNIQUE,   -- 코드: 'kyobo', 'yes24', 'aladin'
    name        text         NOT NULL,          -- 화면 표시용 이름: '교보문고'
    has_sales_point boolean  NOT NULL DEFAULT false  -- 판매지수를 제공하는 서점인가
);

INSERT INTO stores (id, code, name, has_sales_point) VALUES
    (1, 'kyobo',  '교보문고', false),   -- 교보는 판매지수 없음 → 순위·서지정보만
    (2, 'yes24',  '예스24',   true),    -- 판매지수 있음
    (3, 'aladin', '알라딘',   true)     -- 세일즈포인트 있음
ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name, has_sales_point = EXCLUDED.has_sales_point;


-- ============================================================================
--  2. categories — 수집 대상 카테고리
-- ============================================================================
--  ※ 이 표는 손으로 채우지 마세요.
--    config/sources.yaml 파일을 고치면 매일 수집할 때 자동으로 동기화됩니다.
-- ============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id            serial     PRIMARY KEY,
    store_id      smallint   NOT NULL REFERENCES stores(id),
    code          text       NOT NULL,          -- 서점 내부 카테고리 코드
    name          text       NOT NULL,          -- 분야 이름: '경제경영'
    kind          text       NOT NULL,          -- 'online'(온라인) | 'offline'(오프라인 매장)
    branch_code   text       NOT NULL DEFAULT '',  -- 교보 매장 코드 ('001'=광화문점). 온라인은 빈 값
    branch_name   text       NOT NULL DEFAULT '',  -- 매장 이름 ('광화문점')
    unified_code  text,                         -- 통합 분야 코드 (서점 간 비교용)
    url_template  text       NOT NULL,          -- 수집 URL (페이지 번호 자리는 {page})
    max_items     int        NOT NULL DEFAULT 200,  -- 이 카테고리에서 최대 몇 권까지 수집할지
    page_size     int        NOT NULL DEFAULT 20,   -- 한 페이지에 몇 권이 나오는지
    enabled       boolean    NOT NULL DEFAULT true, -- false로 바꾸면 수집에서 제외
    UNIQUE (store_id, kind, branch_code, code)
);

CREATE INDEX IF NOT EXISTS idx_categories_store   ON categories(store_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_categories_unified ON categories(unified_code);


-- ============================================================================
--  3. books — 도서 마스터 (3사 데이터를 하나로 묶은 결과)
-- ============================================================================
--  내부 book_id가 기준키입니다. ISBN이 없어도 만들어집니다.
-- ============================================================================
CREATE TABLE IF NOT EXISTS books (
    id                bigserial   PRIMARY KEY,
    title             text        NOT NULL,     -- 대표 제목
    author            text,                     -- 대표 저자
    publisher         text,                     -- 대표 출판사
    pub_ym            text,                     -- 대표 출간월 'YYYY-MM'
    isbn13            text,                     -- 있으면 저장, 없어도 됨(NULL 허용)
    cover_url         text,                     -- 표지 이미지 주소 (알라딘 우선)
    cover_source      text,                     -- 표지 출처: 'aladin'|'yes24'|'kyobo'
    match_confidence  text        NOT NULL DEFAULT 'single',
        -- 'single' = 아직 한 서점에서만 발견됨
        -- 'high'   = 85점 이상으로 자동 병합됨
        -- 'low'    = 65~84점, 관리자 검토 대기
        -- 'manual' = 사람이 직접 확정함
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_books_isbn       ON books(isbn13) WHERE isbn13 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_books_confidence ON books(match_confidence) WHERE match_confidence = 'low';
-- 검색용 인덱스 (제목/저자/출판사 부분 일치 검색을 빠르게)
CREATE INDEX IF NOT EXISTS idx_books_title_trgm     ON books USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_books_publisher_trgm ON books USING gin (publisher gin_trgm_ops);


-- ============================================================================
--  4. store_books — 서점별 도서 (같은 책이라도 서점마다 1행씩)
-- ============================================================================
CREATE TABLE IF NOT EXISTS store_books (
    id              bigserial   PRIMARY KEY,
    store_id        smallint    NOT NULL REFERENCES stores(id),
    store_book_key  text        NOT NULL,   -- 서점 내부 상품번호 (목록 페이지에서 얻은 것)

    -- 원본 값: 서점이 보여준 그대로 보존 (절대 가공하지 않음)
    raw_title       text        NOT NULL,
    raw_author      text,
    raw_publisher   text,
    raw_pub_date    text,       -- 서점마다 형식이 달라서 문자열 그대로 저장

    -- 정규화 값: 비교(매칭)에 쓰는 통일된 값
    norm_title      text,       -- 핵심 제목 (부제·에디션 표기 제거 후)
    norm_subtitle   text,       -- 분리해낸 부제
    norm_author     text,       -- 대표 저자 (역할어 제거)
    norm_publisher  text,       -- 정규화된 출판사명
    pub_ym          text,       -- 'YYYY-MM' 까지만 통일
    pub_date        date,       -- 일자까지 알 수 있으면 보관(비교엔 안 씀)

    -- 【2026-08-11 추가 — 대표님 지적으로 발견】
    -- 정가는 도서정가제상 출판사가 정한 하나의 값이라 3사가 같아야 정상입니다.
    -- 판형·개정판이 다르면 정가가 다르므로 '다른 책' 근거로도 씁니다.
    -- 판매가는 서점마다 다릅니다 (할인율이 달라서). 매칭에는 쓰지 않습니다.
    list_price      int,        -- 정가 (원)
    sale_price      int,        -- 실제 판매가 (할인 적용)

    isbn13          text,       -- 목록에 노출되는 서점만 저장
    cover_url       text,       -- 목록 페이지에서 얻은 표지 주소 (작은 썸네일 우선)
    edition_tags    text[]      NOT NULL DEFAULT '{}',  -- ['개정판','리커버','양장본']
    set_volumes     int,        -- '전7권'이면 7. 세트가 아니면 NULL

    book_id         bigint      REFERENCES books(id) ON DELETE SET NULL,

    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (store_id, store_book_key)
);

CREATE INDEX IF NOT EXISTS idx_store_books_book   ON store_books(book_id);
CREATE INDEX IF NOT EXISTS idx_store_books_unmatched ON store_books(store_id) WHERE book_id IS NULL;
-- 블로킹 키: 후보를 좁힐 때 쓰는 인덱스 (핵심제목 앞부분 + 대표저자)
CREATE INDEX IF NOT EXISTS idx_store_books_block  ON store_books(left(norm_title, 6), norm_author);
CREATE INDEX IF NOT EXISTS idx_store_books_isbn   ON store_books(isbn13) WHERE isbn13 IS NOT NULL;


-- ============================================================================
--  5. book_matches — 매칭 근거 (왜 묶였는지 추적용)
-- ============================================================================
CREATE TABLE IF NOT EXISTS book_matches (
    id                bigserial   PRIMARY KEY,
    store_book_a      bigint      NOT NULL REFERENCES store_books(id) ON DELETE CASCADE,
    store_book_b      bigint      NOT NULL REFERENCES store_books(id) ON DELETE CASCADE,
    score             int         NOT NULL,   -- 합산 점수
    reasons           jsonb       NOT NULL DEFAULT '{}'::jsonb,
        -- 예: {"title_sim":0.94,"author":true,"publisher":true,"pub_ym":"exact"}
    decision          text        NOT NULL,
        -- 'auto_high'     = 85점 이상 자동 병합
        -- 'auto_low'      = 65~84점 병합했지만 검토 필요
        -- 'rejected'      = 65점 미만, 다른 책으로 판정
        -- 'manual_merge'  = 사람이 "맞음" 누름  ← 자동 로직이 절대 못 뒤집음
        -- 'manual_split'  = 사람이 "아님" 누름  ← 영구 블랙리스트
    decided_by        uuid,                   -- 수동 결정한 사용자 (자동이면 NULL)
    decided_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),

    -- 같은 쌍이 중복 저장되지 않게. (작은 id, 큰 id) 순서로만 저장하도록 코드에서 보장
    UNIQUE (store_book_a, store_book_b),
    CHECK (store_book_a < store_book_b)
);

CREATE INDEX IF NOT EXISTS idx_matches_review ON book_matches(decision)
    WHERE decision = 'auto_low';
-- 사람이 내린 결정은 따로 빠르게 조회 (자동 매칭이 이걸 먼저 확인해야 함)
CREATE INDEX IF NOT EXISTS idx_matches_manual ON book_matches(store_book_a, store_book_b)
    WHERE decision IN ('manual_merge', 'manual_split');


-- ============================================================================
--  6. rankings — 일별 순위 스냅샷  ★ 가장 큰 표. 이력 추적의 핵심
-- ============================================================================
--  멱등성(같은 날 다시 돌려도 중복 안 생김):
--    기본키가 (날짜, 카테고리, 순위)라서 재실행하면 덮어쓰기만 됩니다.
-- ============================================================================
CREATE TABLE IF NOT EXISTS rankings (
    snapshot_date   date       NOT NULL,       -- 수집 날짜 (한국시간 기준)
    category_id     int        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    rank            smallint   NOT NULL,       -- 순위 (1위 = 1)
    store_book_id   bigint     NOT NULL REFERENCES store_books(id) ON DELETE CASCADE,
    sales_point     int,                       -- 판매지수/세일즈포인트. 교보는 NULL

    PRIMARY KEY (snapshot_date, category_id, rank)
);

-- 특정 책의 순위 변동 그래프를 그릴 때 쓰는 인덱스
CREATE INDEX IF NOT EXISTS idx_rankings_book ON rankings(store_book_id, snapshot_date DESC);
-- 특정 날짜 전체 조회 (목록 화면 기본 조회)
CREATE INDEX IF NOT EXISTS idx_rankings_date ON rankings(snapshot_date DESC, category_id);


-- ============================================================================
--  7. book_meta — 해시태그/이벤트 (목록 페이지에서 얻어지는 범위 내에서만)
-- ============================================================================
--  【2026-08-10 — 날짜별에서 책마다 한 줄로 바꿨습니다】
--  재 보니 131,351줄 중 60,685줄(46.2%)이 어제와 글자 하나 안 달랐고,
--  실제로 값이 바뀐 줄은 2,240줄(1.7%)뿐이었습니다. 게다가 사이트는
--  이 자료를 읽지도 않습니다. 아무도 안 보는 기록에 용량을 쓰던 것을
--  최신 값 하나만 두는 것으로 바꿨습니다.
--  ⚠️ 이미 운영 중인 데이터베이스는 db/meta-slim.sql 을 실행해야 합니다.
CREATE TABLE IF NOT EXISTS book_meta (
    store_book_id   bigint     PRIMARY KEY REFERENCES store_books(id) ON DELETE CASCADE,
    snapshot_date   date       NOT NULL,   -- 이 값을 마지막으로 본 날 (참고용)
    hashtags        text[]     NOT NULL DEFAULT '{}',  -- 예스24 해시태그 키워드
    events          text[]     NOT NULL DEFAULT '{}'   -- 이벤트 문구
);


-- ============================================================================
--  8. crawl_logs — 수집 실행 기록 (실패했을 때 여기를 봅니다)
-- ============================================================================
CREATE TABLE IF NOT EXISTS crawl_logs (
    id              bigserial   PRIMARY KEY,
    run_id          text,                   -- GitHub Actions 실행 번호
    store_id        smallint    REFERENCES stores(id),
    category_id     int         REFERENCES categories(id) ON DELETE SET NULL,
    snapshot_date   date        NOT NULL,
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    status          text        NOT NULL,   -- 'success' | 'failed' | 'partial'
    items_collected int         NOT NULL DEFAULT 0,   -- 실제로 수집된 건수
    items_expected  int,                    -- 기대했던 건수 (자가 점검용)
    error_message   text,                   -- 실패 사유 (사람이 읽을 수 있게)
    http_stats      jsonb       NOT NULL DEFAULT '{}'::jsonb
        -- 예: {"requests":42,"200":40,"403":2,"retries":3,"elapsed_sec":88}
);

CREATE INDEX IF NOT EXISTS idx_crawl_logs_recent ON crawl_logs(snapshot_date DESC, store_id);
CREATE INDEX IF NOT EXISTS idx_crawl_logs_failed ON crawl_logs(snapshot_date DESC)
    WHERE status <> 'success';


-- ============================================================================
--  9. daily_reports — AI 인사이트 리포트
-- ============================================================================
CREATE TABLE IF NOT EXISTS daily_reports (
    report_date     date        PRIMARY KEY,
    model           text        NOT NULL,   -- 사용한 AI 모델 이름
    content_md      text        NOT NULL,   -- 마크다운 본문
    input_tokens    int,
    output_tokens   int,
    cost_usd        numeric(10, 6),         -- 이 1건에 든 비용
    created_at      timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
--  10. profiles — 사용자 (Supabase 로그인 계정에 권한을 붙임)
-- ============================================================================
CREATE TABLE IF NOT EXISTS profiles (
    id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email       text        NOT NULL,
    role        text        NOT NULL DEFAULT 'viewer',  -- 'admin' | 'viewer'
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (role IN ('admin', 'viewer'))
);


-- ============================================================================
--  11. public_links — 로그인 없이 볼 수 있는 공개 링크
-- ============================================================================
CREATE TABLE IF NOT EXISTS public_links (
    token       text        PRIMARY KEY,    -- 주소에 들어가는 임의의 긴 문자열
    kind        text        NOT NULL,       -- 'book' (도서 상세) | 'report' (리포트)
    target_id   text        NOT NULL,       -- book_id 또는 report_date
    enabled     boolean     NOT NULL DEFAULT true,  -- false로 바꾸면 즉시 링크 비활성
    created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz,                -- NULL이면 만료 없음
    CHECK (kind IN ('book', 'report'))
);

CREATE INDEX IF NOT EXISTS idx_public_links_active ON public_links(kind, target_id)
    WHERE enabled;
