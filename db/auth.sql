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
--  지금은 관리자만 할 수 있는 기능이 아직 없지만(매칭 검토 화면은 다음
--  단계입니다), 미리 지정해 두면 그때 바로 쓸 수 있습니다.
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
--  5. 제대로 잠겼는지 확인
-- ---------------------------------------------------------------------------
--  아래 표가 나옵니다. 읽어야 할 곳은 딱 두 칸입니다.
--
--    · 공개용_읽기  전부 0 이어야 합니다  ← 0 이 아니면 아직 열려 있습니다
--    · 회원_읽기    전부 1 이어야 합니다  ← 0 이면 회원도 못 봅니다
-- ---------------------------------------------------------------------------
SELECT
    c.relname AS "표 이름",
    c.relrowsecurity AS "잠금_켜짐",
    count(*) FILTER (
        WHERE p.polcmd = 'r' AND 'anon' = ANY (
            SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)
        )
    ) AS "공개용_읽기",
    count(*) FILTER (
        WHERE p.polcmd = 'r' AND 'authenticated' = ANY (
            SELECT rolname FROM pg_roles WHERE oid = ANY (p.polroles)
        )
    ) AS "회원_읽기"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
      'stores', 'categories', 'books', 'store_books', 'book_matches',
      'rankings', 'book_meta', 'crawl_logs', 'daily_reports', 'archives',
      'profiles'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
