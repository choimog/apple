-- ============================================================================
--  [출판사 묶기] — "이 둘은 같은 출판사" 를 사람이 정해 두는 표
-- ============================================================================
--
--  【왜 필요한가요? — 2026-08-12 대표님 요청】
--
--    "한빛life 랑 한빛라이프처럼, 서점마다 출판사를 표기하는 명칭이
--     조금씩 다른데 이것도 다 규칙화하기 어려울 것 같아서."
--
--  맞습니다. 글자로는 절대 못 잡습니다.
--
--      한빛life  vs  한빛라이프      닮은 정도 0.29   (기준 0.80)
--      스콜라    vs  위즈덤하우스     0.00            ← 이건 진짜 다른 곳
--
--  괄호로 밝혀 준 경우(`윌북(willbook)`)는 이미 프로그램이 잡습니다.
--  하지만 어느 서점도 괄호로 안 적어 주면 방법이 없습니다.
--  그때 대표님이 직접 정해 두시는 표입니다.
--
--  【이 표가 하는 일 — 딱 한 가지입니다】
--  "이 이름과 저 이름은 같은 곳" 이라고 알려 주는 것뿐입니다.
--  순위·점수·판매지수 같은 숫자는 **하나도 건드리지 않습니다.**
--  순위는 매일 처음부터 다시 계산하므로, 표를 지우면 곧바로 원래대로
--  돌아갑니다. 쌓이거나 어긋나는 값이 없습니다.
--
--  【어떻게 실행하나요?】
--    Supabase → 왼쪽 [SQL Editor] → [New query] → 이 파일 전체 붙여넣기
--    → 오른쪽 아래 [Run]
--    맨 아래에 확인 표가 한 개 나옵니다. 전부 ✅ 면 끝입니다.
--
--  ⚠️ 여러 번 실행해도 안전합니다.
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1. 표 만들기
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publisher_aliases (
    -- 정규화한 출판사 이름. store_books.norm_publisher 와 같은 모양입니다.
    -- 한 이름은 한 무리에만 속할 수 있으므로 이것이 열쇠입니다.
    name        text        PRIMARY KEY,

    -- 이 무리의 대표 이름. **화면에 이 이름으로 나옵니다.**
    -- 같은 canonical 을 가진 줄들이 한 무리입니다.
    canonical   text        NOT NULL,

    -- 서점이 실제로 적은 예시. 사람이 목록에서 알아보기 위한 것입니다.
    raw_sample  text,

    created_by  uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CHECK (length(btrim(name)) > 0),
    CHECK (length(btrim(canonical)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_pub_alias_canonical
    ON publisher_aliases(canonical);

COMMENT ON TABLE publisher_aliases IS
    '사람이 정한 "이 둘은 같은 출판사". 매칭과 순위 표기가 함께 씁니다';


-- ----------------------------------------------------------------------------
--  2. 누가 읽고 누가 쓸 수 있나
-- ----------------------------------------------------------------------------
--  읽기 : 로그인한 사람 (화면에서 목록을 봐야 하니까)
--  쓰기 : 관리자만
--
--  ⚠️ 이 표는 **지우기도 허용**합니다. 다른 표와 다른 점입니다.
--     잘못 묶었을 때 되돌릴 방법이 있어야 하기 때문입니다.
--     지워도 잃는 자료가 없습니다 — 순위는 매일 다시 계산합니다.
-- ----------------------------------------------------------------------------
ALTER TABLE publisher_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "회원만 읽기" ON publisher_aliases;
CREATE POLICY "회원만 읽기" ON publisher_aliases
    FOR SELECT TO authenticated USING (true);

GRANT SELECT ON publisher_aliases TO authenticated;
GRANT INSERT (name, canonical, raw_sample, created_by) ON publisher_aliases
    TO authenticated;
GRANT DELETE ON publisher_aliases TO authenticated;

DROP POLICY IF EXISTS "관리자만 출판사 묶기" ON publisher_aliases;
CREATE POLICY "관리자만 출판사 묶기" ON publisher_aliases
    FOR INSERT TO authenticated
    -- 남의 이름으로 적지 못하게 막습니다 (화면이 보내는 값을 안 믿습니다)
    WITH CHECK (is_admin() AND created_by = auth.uid());

DROP POLICY IF EXISTS "관리자만 출판사 풀기" ON publisher_aliases;
CREATE POLICY "관리자만 출판사 풀기" ON publisher_aliases
    FOR DELETE TO authenticated
    USING (is_admin());


-- ----------------------------------------------------------------------------
--  3. 확인
-- ----------------------------------------------------------------------------
--  ⚠️ 결과 표는 **하나만** 나오게 만들었습니다. Supabase 화면은 여러 표를
--    보내면 마지막 것만 보여줘서, 앞의 결과를 못 보고 지나칩니다.
-- ----------------------------------------------------------------------------
WITH tbl AS (
    SELECT count(*) AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'publisher_aliases' AND c.relkind = 'r'
),
rls AS (
    SELECT count(*) AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'publisher_aliases' AND c.relrowsecurity
),
pol AS (
    SELECT count(*) AS v FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'publisher_aliases'
),
rows_now AS (SELECT count(*) AS v FROM publisher_aliases),
groups_now AS (SELECT count(DISTINCT canonical) AS v FROM publisher_aliases)
SELECT * FROM (
    SELECT 1 AS "번호", '표가 만들어졌는가' AS "확인 항목",
           (SELECT v FROM tbl) || '개' AS "결과",
           CASE WHEN (SELECT v FROM tbl) = 1 THEN '✅' ELSE '❌ 다시 실행하세요' END AS "판정"
    UNION ALL
    SELECT 2, '잠겨 있는가 (로그인 없이는 못 봄)',
           CASE WHEN (SELECT v FROM rls) = 1 THEN '켜짐' ELSE '꺼짐' END,
           CASE WHEN (SELECT v FROM rls) = 1 THEN '✅' ELSE '🚨 저에게 알려 주세요' END
    UNION ALL
    SELECT 3, '규칙 개수 (읽기·묶기·풀기)',
           (SELECT v FROM pol) || '개',
           CASE WHEN (SELECT v FROM pol) = 3 THEN '✅' ELSE '❌ 다시 실행하세요' END
    UNION ALL
    SELECT 4, '지금 정해 둔 이름 수',
           (SELECT v FROM rows_now) || '개',
           '처음이면 0개가 맞습니다'
    UNION ALL
    SELECT 5, '지금 만들어진 무리 수',
           (SELECT v FROM groups_now) || '개',
           '처음이면 0개가 맞습니다'
) t ORDER BY "번호";
