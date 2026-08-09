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


-- ----------------------------------------------------------------------------
--  2026-08-08 추가 — GitHub 보관을 쓸 때 필요한 칸
-- ----------------------------------------------------------------------------
--  대표님이 카드 등록 없이 GitHub 에 보관하기로 하셨습니다.
--  R2 와 결정적으로 다른 점이 있습니다.
--
--      R2      올려두면 영구 보관
--      GitHub  기한이 지나면 자동으로 사라집니다
--
--  그래서 '언제 사라지는지' 를 반드시 기록해 둬야 합니다. 이 값이 없으면
--  대표님이 언제까지 내려받아야 하는지 알 수 없습니다.
--
--  ※ 이미 만들어진 표에도 안전하게 더해집니다. 여러 번 실행해도 됩니다.
-- ----------------------------------------------------------------------------
ALTER TABLE archives ADD COLUMN IF NOT EXISTS storage    text NOT NULL DEFAULT 'r2';
ALTER TABLE archives ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE archives ADD COLUMN IF NOT EXISTS run_url    text;

COMMENT ON COLUMN archives.storage    IS 'r2 | github — 어디에 보관했는지';
COMMENT ON COLUMN archives.expires_at IS 'GitHub 보관일 때 파일이 사라지는 날';
COMMENT ON COLUMN archives.run_url    IS '파일을 내려받을 수 있는 주소';

-- 곧 사라지는 것부터 찾기 위한 색인
CREATE INDEX IF NOT EXISTS idx_archives_expiry ON archives(expires_at)
    WHERE expires_at IS NOT NULL;


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
