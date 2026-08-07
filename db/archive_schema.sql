-- ============================================================================
--  보관소(아카이브) 기록표 — Supabase 에서 한 번 실행
-- ============================================================================
--
--  【이게 왜 필요한가요?】
--  Supabase 무료 용량(500MB)은 지금 수집량으로 한 달이면 찹니다.
--  그래서 오래된 순위 기록은 Cloudflare R2(무료 10GB)로 옮깁니다.
--
--  옮긴 뒤에도 "어느 날짜가 어디에 있는지" 를 알아야 하므로,
--  옮긴 내역을 이 표에 남깁니다. 사이트도 이 표를 보고
--  "2026-01-01 이전은 보관소에 있습니다" 라고 안내합니다.
--
--  【실행 방법】
--  Supabase → SQL Editor → New query → 아래 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다.
-- ============================================================================

CREATE TABLE IF NOT EXISTS archives (
    id            bigserial   PRIMARY KEY,
    snapshot_date date        NOT NULL,     -- 옮긴 날짜
    table_name    text        NOT NULL,     -- 'rankings' | 'book_meta'
    object_key    text        NOT NULL,     -- 보관소 안의 파일 이름
    row_count     int         NOT NULL,     -- 옮긴 줄 수
    byte_size     bigint      NOT NULL,     -- 파일 크기
    sha256        text        NOT NULL,     -- 파일이 온전한지 확인하는 지문
    deleted_from_db boolean   NOT NULL DEFAULT false,  -- DB 에서 지웠는지
    created_at    timestamptz NOT NULL DEFAULT now(),

    UNIQUE (snapshot_date, table_name)
);

CREATE INDEX IF NOT EXISTS idx_archives_date ON archives(snapshot_date DESC);


-- ---------------------------------------------------------------------------
--  보안: 이 표도 읽기만 허용합니다 (db/rls.sql 과 같은 원칙)
-- ---------------------------------------------------------------------------
ALTER TABLE archives ENABLE ROW LEVEL SECURITY;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON archives FROM anon, authenticated;

DROP POLICY IF EXISTS "누구나 읽기" ON archives;
CREATE POLICY "누구나 읽기" ON archives
    FOR SELECT TO anon, authenticated USING (true);


-- ---------------------------------------------------------------------------
--  확인
-- ---------------------------------------------------------------------------
SELECT
    c.relname        AS "표 이름",
    c.relrowsecurity AS "rls_켜짐",
    count(p.polname) FILTER (WHERE p.polcmd = 'r') AS "읽기규칙"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public' AND c.relname = 'archives'
GROUP BY c.relname, c.relrowsecurity;
