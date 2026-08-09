-- ============================================================================
--  회원 전용으로 잠그기 — Supabase 에서 한 번 실행
-- ============================================================================
--
--  【2026-08-09 대표님 결정】
--  "비상업적으로 친구들한테만 회원 형식으로 공유하려고 하는 거야."
--
--  【문이 두 개입니다. 하나만 잠그면 잠근 척이 됩니다】
--
--    문 1  사이트         web/middleware.ts 가 막습니다 (이미 되어 있음)
--    문 2  데이터베이스    ← 이 파일이 막습니다
--
--  문 2 가 왜 필요한가:
--  사이트가 쓰는 '공개용 열쇠(anon key)' 는 브라우저 안에 그대로 들어
--  있습니다. 감출 수 있는 값이 아닙니다. 지금은 그 열쇠만 있으면 사이트를
--  거치지 않고 데이터베이스에 직접 물어볼 수 있습니다.
--  사이트만 막으면 그 길이 그대로 열려 있습니다.
--
--  이 파일을 실행하면, 공개용 열쇠로는 아무것도 안 보이고
--  **로그인한 회원에게만** 보이게 됩니다.
--
--  【실행 방법】
--  Supabase → SQL Editor → New query → 아래 전체 붙여넣고 Run
--  ※ 여러 번 실행해도 안전합니다. 자료는 하나도 안 바뀝니다.
--
--  ⚠️ 실행하기 전에 계정을 먼저 하나 만드세요.
--     안 그러면 대표님도 사이트를 못 보십니다.
--     만드는 법: docs/login-setup.md
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. 로그인하면 회원 명부(profiles)에 줄이 자동으로 생기게
-- ---------------------------------------------------------------------------
--  Supabase 의 계정 목록(auth.users)과 우리 권한표(profiles)는 다른 표입니다.
--  손으로 옮겨 적게 하면 반드시 빠뜨립니다. 그래서 자동으로 만듭니다.
--
--  처음 만들어지는 권한은 언제나 'viewer'(보기 전용)입니다.
--  관리자로 올리는 것은 아래 3번에서 손으로 합니다 —
--  가입만 하면 관리자가 되는 구조는 만들면 안 됩니다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'viewer')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 이 파일을 실행하기 전에 이미 만들어 둔 계정도 명부에 넣어 줍니다
INSERT INTO profiles (id, email, role)
SELECT u.id, u.email, 'viewer'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
--  2. 내 권한은 내가 볼 수 있게
-- ---------------------------------------------------------------------------
--  화면이 "이 사람이 관리자인가" 를 물어봐야 합니다.
--  남의 줄은 안 보입니다. 회원 명단이 통째로 새어 나가면 안 됩니다.
-- ---------------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "내 것만 읽기" ON profiles;
CREATE POLICY "내 것만 읽기" ON profiles
    FOR SELECT TO authenticated USING (id = auth.uid());

-- 권한을 스스로 바꾸지 못하게 합니다.
-- 이게 없으면 보기 전용 회원이 스스로 관리자가 될 수 있습니다.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON profiles FROM anon, authenticated;


-- ---------------------------------------------------------------------------
--  3. 관리자 지정 (대표님 계정)
-- ---------------------------------------------------------------------------
--  아래 이메일을 대표님 것으로 바꾸고 실행하세요.
--  관리자만 [매칭 검토] 화면에서 '같은 책 / 다른 책' 을 고칠 수 있습니다.
--  나머지 회원은 순위를 보기만 합니다.
-- ---------------------------------------------------------------------------
UPDATE profiles SET role = 'admin'
WHERE email = 'hssh8159@gmail.com';


-- ---------------------------------------------------------------------------
--  4. 자료는 회원에게만 보이게 — 여기가 핵심입니다
-- ---------------------------------------------------------------------------
--  db/rls.sql 에서는 이렇게 되어 있었습니다.
--
--      FOR SELECT TO anon, authenticated USING (true)
--                    ^^^^ 누구나
--
--  이 anon(공개용) 을 떼어냅니다. 로그인한 사람만 남습니다.
--
--  ⚠️ 수집 작업은 영향을 받지 않습니다.
--     크롤러는 'service_role'(관리자 열쇠)로 접속하는데, 이 열쇠는
--     보안 규칙을 통과합니다. 매일 수집은 그대로 돕니다.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'stores', 'categories', 'books', 'store_books', 'book_matches',
        'rankings', 'book_meta', 'crawl_logs', 'daily_reports', 'archives'
    ]
    LOOP
        -- 표가 아직 없을 수도 있습니다 (archives 등). 있으면만 손봅니다.
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE '건너뜀: % (표가 없습니다)', t;
            CONTINUE;
        END IF;

        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "누구나 읽기" ON %I', t);
        EXECUTE format('DROP POLICY IF EXISTS "회원만 읽기" ON %I', t);
        EXECUTE format(
            'CREATE POLICY "회원만 읽기" ON %I FOR SELECT TO authenticated USING (true)', t
        );
        -- 쓰기는 계속 막아 둡니다 (db/rls.sql 과 같은 원칙)
        EXECUTE format(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON %I FROM anon, authenticated', t
        );
    END LOOP;
END $$;


-- ---------------------------------------------------------------------------
--  5. 관리자만 '같은 책 / 다른 책' 을 고칠 수 있게
-- ---------------------------------------------------------------------------
--  매칭 검토 화면(/review)이 쓰는 권한입니다.
--
--  【왜 필요한가요?】
--  같은 책 묶기는 애매한 경우를 '검토 필요' 로 표시만 하고 넘어갑니다.
--  그런데 사람이 그 결정을 내릴 방법이 없었습니다.
--  코드는 "사람이 내린 결정이 최우선" 이라고 되어 있는데, 정작 결정할
--  화면이 없어서 **잘못 묶인 책을 발견해도 고칠 수가 없었습니다.**
--
--  【열어주는 범위를 최대한 좁혔습니다】
--    · book_matches 표 하나만
--    · 그중에서도 칸 3개만 (decision / decided_by / decided_at)
--    · 그중에서도 role='admin' 인 사람만
--    · 새 줄을 만들거나 지우는 것은 여전히 못 합니다
--  이렇게 하면 보기 전용 회원이 순위 자료를 건드릴 방법이 없습니다.
-- ---------------------------------------------------------------------------

-- 자동으로 내려졌던 판단을 남겨 둡니다.
-- 이게 없으면 사람이 한 번 누른 뒤에는 '되돌리기' 를 할 수 없습니다.
-- (원래 뭐였는지 모르니까요)
ALTER TABLE book_matches ADD COLUMN IF NOT EXISTS auto_decision text;

COMMENT ON COLUMN book_matches.auto_decision IS
    '사람이 고치기 전, 자동으로 내려졌던 판단. 되돌리기에 씁니다';

-- 지금 있는 줄들의 원래 판단을 채워 둡니다 (자동 판단만)
UPDATE book_matches
   SET auto_decision = decision
 WHERE auto_decision IS NULL
   AND decision IN ('auto_high', 'auto_low', 'rejected');

-- 관리자인지 확인하는 함수.
-- profiles 는 '내 것만 읽기' 라 정책 안에서 직접 못 봅니다. 그래서
-- SECURITY DEFINER 로 만들되, 하는 일은 '예/아니오' 하나뿐입니다.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    );
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- 칸 3개에만 쓰기를 허용합니다 (표 전체가 아닙니다)
GRANT UPDATE (decision, decided_by, decided_at) ON book_matches TO authenticated;

DROP POLICY IF EXISTS "관리자만 판단 고치기" ON book_matches;
CREATE POLICY "관리자만 판단 고치기" ON book_matches
    FOR UPDATE TO authenticated
    USING (is_admin())
    -- ⚠️ '누가 결정했는지' 를 남의 이름으로 적지 못하게 막습니다.
    --    화면에서 보내는 값을 그대로 믿으면 안 됩니다.
    --
    --    NULL 을 함께 허용하는 것은 '되돌리기' 때문입니다. 되돌리면
    --    그건 더 이상 사람이 내린 결정이 아니므로 이름을 지웁니다.
    --    (처음에 = auth.uid() 만 적었다가, 되돌리기가 막히는 것을
    --     발견하고 고쳤습니다 — 2026-08-09)
    WITH CHECK (
        is_admin() AND (decided_by IS NULL OR decided_by = auth.uid())
    );

-- ⚠️ db/rls.sql 을 나중에 다시 실행하시면, 그 안의 REVOKE 때문에 위
--    GRANT 가 사라집니다. 그러면 검토 화면에서 버튼을 눌러도
--    "권한이 없습니다" 가 뜹니다. 그때는 이 파일을 한 번 더 실행하세요.


-- ---------------------------------------------------------------------------
--  6. 제대로 됐는지 확인 — 이 하나만 보시면 됩니다
-- ---------------------------------------------------------------------------
--  【2026-08-09 고침】
--  원래는 확인 조회를 두 개로 나눠 놨는데, Supabase 는 **맨 마지막 결과만**
--  보여줍니다. 그래서 정작 제일 중요한 '잠금 확인' 을 대표님이 못 보셨습니다.
--  하나로 합쳤습니다.
--
--  아래 5줄이 나옵니다. **판정 칸이 전부 ✅ 면 끝난 것입니다.**
-- ---------------------------------------------------------------------------
WITH want AS (
    SELECT unnest(ARRAY[
        'stores', 'categories', 'books', 'store_books', 'book_matches',
        'rankings', 'book_meta', 'crawl_logs', 'daily_reports', 'archives',
        'profiles'
    ]) AS name
),
tbl AS (
    SELECT c.oid, c.relname AS name, c.relrowsecurity AS rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN want w ON w.name = c.relname
    WHERE n.nspname = 'public' AND c.relkind = 'r'
),
pol AS (
    SELECT
        t.name,
        t.rls_on,
        -- ⚠️ 0 은 PUBLIC(모두) 입니다. TO 를 안 적은 규칙이 그렇게 됩니다.
        --    그것도 '로그인 없이 보인다' 로 세야 합니다. 안 그러면
        --    열려 있는데 ✅ 가 뜹니다.
        count(*) FILTER (
            WHERE p.polcmd = 'r' AND (
                0 = ANY (p.polroles) OR EXISTS (
                    SELECT 1 FROM pg_roles r
                    WHERE r.oid = ANY (p.polroles) AND r.rolname = 'anon'
                )
            )
        ) AS anon_read,
        count(*) FILTER (
            WHERE p.polcmd = 'r' AND (
                0 = ANY (p.polroles) OR EXISTS (
                    SELECT 1 FROM pg_roles r
                    WHERE r.oid = ANY (p.polroles) AND r.rolname = 'authenticated'
                )
            )
        ) AS member_read
    FROM tbl t
    LEFT JOIN pg_policy p ON p.polrelid = t.oid
    GROUP BY t.name, t.rls_on
),
n_open   AS (SELECT count(*) AS v FROM pol WHERE anon_read > 0),
n_unlock AS (SELECT count(*) AS v FROM pol WHERE NOT rls_on),
n_member AS (SELECT count(*) AS v FROM pol WHERE member_read > 0),
n_all    AS (SELECT count(*) AS v FROM pol),
n_grant  AS (
    SELECT count(*) AS v FROM information_schema.column_privileges
    WHERE table_schema = 'public' AND table_name = 'book_matches'
      AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
      AND column_name IN ('decision', 'decided_by', 'decided_at')
),
n_admin  AS (SELECT count(*) AS v FROM profiles WHERE role = 'admin')
SELECT * FROM (
    SELECT 1 AS "번호",
           '로그인 없이 보이는 표' AS "확인 항목",
           (SELECT v FROM n_open) || '개' AS "결과",
           CASE WHEN (SELECT v FROM n_open) = 0
                THEN '✅ 잘 잠겼습니다'
                ELSE '❌ 아직 열려 있습니다. 이 파일을 다시 실행하세요' END AS "판정"
    UNION ALL
    SELECT 2, '잠금이 꺼진 표',
           (SELECT v FROM n_unlock) || '개',
           CASE WHEN (SELECT v FROM n_unlock) = 0
                THEN '✅ 전부 켜져 있습니다'
                ELSE '❌ 꺼진 표가 있습니다' END
    UNION ALL
    SELECT 3, '회원이 볼 수 있는 표',
           (SELECT v FROM n_member) || ' / ' || (SELECT v FROM n_all) || '개',
           CASE WHEN (SELECT v FROM n_member) = (SELECT v FROM n_all)
                THEN '✅ 회원은 다 볼 수 있습니다'
                ELSE '❌ 회원도 못 보는 표가 있습니다' END
    UNION ALL
    SELECT 4, '검토 화면 쓰기 권한',
           (SELECT v FROM n_grant) || ' / 3칸',
           CASE WHEN (SELECT v FROM n_grant) = 3
                THEN '✅ 버튼이 동작합니다'
                ELSE '❌ 검토 버튼이 실패합니다' END
    UNION ALL
    SELECT 5, '관리자 계정',
           (SELECT v FROM n_admin) || '명',
           CASE WHEN (SELECT v FROM n_admin) >= 1
                THEN '✅ 매칭 검토 메뉴가 보입니다'
                ELSE '❌ 위 3번의 이메일이 계정과 다릅니다' END
) x
ORDER BY "번호";
