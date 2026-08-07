-- ============================================================================
--  보안 설정 (RLS) — ⚠️ 반드시 실행해야 합니다
-- ============================================================================
--
--  【이 파일을 왜 실행해야 하나요?】
--
--  사이트가 데이터를 읽을 때 쓰는 '공개용 열쇠(anon key)'는
--  사이트를 여는 **모든 사람의 브라우저에 노출**됩니다. 원래 그런 열쇠입니다.
--
--  그런데 Supabase 는 기본 상태에서 그 열쇠에게
--  읽기뿐 아니라 **쓰기·수정·삭제 권한까지** 줍니다.
--  즉 이 파일을 실행하지 않으면, 사이트 주소를 아는 사람이
--  **데이터를 통째로 지울 수 있습니다.**
--
--  이 파일은 그걸 막습니다:
--    ✅ 읽기  → 허용 (사이트가 순위표를 보여줘야 하니까)
--    🚫 쓰기·수정·삭제 → 차단
--    ✅ 수집 작업(GitHub Actions)은 '관리자 열쇠'를 쓰므로 영향 없음
--
--  【부수 효과 — 화면이 비어 보이던 문제도 같이 해결됩니다】
--  Supabase 프로젝트에 따라 이미 보안이 켜져 있고 '읽기 허용' 규칙만
--  없는 경우가 있습니다. 그러면 사이트가 오류 없이 "데이터 0건" 으로 보입니다.
--  아래에서 읽기 허용 규칙을 명시적으로 만들어 주므로 그 경우도 해결됩니다.
--
--  【어떻게 실행하나요?】
--  1. https://supabase.com/dashboard 접속 → 프로젝트 클릭
--  2. 왼쪽 메뉴 [SQL Editor] → [New query]
--  3. 이 파일 전체를 복사해서 붙여넣고 [Run]
--  4. 사이트로 가서 새로고침 (최대 10분 걸릴 수 있습니다)
--
--  ※ 여러 번 실행해도 안전합니다. 데이터는 지워지지 않습니다.
-- ============================================================================


-- ============================================================================
--  1. 모든 표에 보안 잠금을 켭니다
-- ============================================================================
--  이걸 켜면 "허용한다고 적어둔 것만" 가능해집니다.
--  (관리자 열쇠 = service_role 은 이 잠금을 통과합니다. 수집 작업은 그대로 동작)
-- ============================================================================
ALTER TABLE stores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE books         ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_books   ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_matches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rankings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_meta     ENABLE ROW LEVEL SECURITY;
ALTER TABLE crawl_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_links  ENABLE ROW LEVEL SECURITY;


-- ============================================================================
--  2. 쓰기·수정·삭제 권한을 아예 회수합니다
-- ============================================================================
--  1번(잠금)만으로도 막히지만, 권한 자체를 없애서 이중으로 막습니다.
--  "실수로 규칙을 하나 잘못 만들어도 데이터가 안 지워지게" 하기 위함입니다.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
    ON ALL TABLES IN SCHEMA public
    FROM anon, authenticated;

-- 앞으로 새로 만들 표에도 같은 원칙을 적용합니다
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon, authenticated;


-- ============================================================================
--  3. 읽기만 허용합니다 (사이트가 순위표를 보여주기 위해 필요)
-- ============================================================================
--  아래 표들은 서점이 공개한 정보이거나 우리 집계 결과라서 읽기를 엽니다.
--  ※ 개인정보가 담긴 표(profiles, public_links)는 아래 4번에서 따로 잠급니다.
-- ============================================================================

-- 서점 목록 (교보/예스24/알라딘)
DROP POLICY IF EXISTS "누구나 읽기" ON stores;
CREATE POLICY "누구나 읽기" ON stores
    FOR SELECT TO anon, authenticated USING (true);

-- 분야 목록
DROP POLICY IF EXISTS "누구나 읽기" ON categories;
CREATE POLICY "누구나 읽기" ON categories
    FOR SELECT TO anon, authenticated USING (true);

-- 도서 마스터 (같은 책끼리 묶은 결과)
DROP POLICY IF EXISTS "누구나 읽기" ON books;
CREATE POLICY "누구나 읽기" ON books
    FOR SELECT TO anon, authenticated USING (true);

-- 서점별 도서
DROP POLICY IF EXISTS "누구나 읽기" ON store_books;
CREATE POLICY "누구나 읽기" ON store_books
    FOR SELECT TO anon, authenticated USING (true);

-- 매칭 근거 (왜 같은 책으로 묶였는지)
DROP POLICY IF EXISTS "누구나 읽기" ON book_matches;
CREATE POLICY "누구나 읽기" ON book_matches
    FOR SELECT TO anon, authenticated USING (true);

-- 일별 순위 ★ 화면의 핵심
DROP POLICY IF EXISTS "누구나 읽기" ON rankings;
CREATE POLICY "누구나 읽기" ON rankings
    FOR SELECT TO anon, authenticated USING (true);

-- 해시태그·이벤트
DROP POLICY IF EXISTS "누구나 읽기" ON book_meta;
CREATE POLICY "누구나 읽기" ON book_meta
    FOR SELECT TO anon, authenticated USING (true);

-- 수집 기록 (수집 상태 화면에서 성공/실패를 보여주기 위해)
DROP POLICY IF EXISTS "누구나 읽기" ON crawl_logs;
CREATE POLICY "누구나 읽기" ON crawl_logs
    FOR SELECT TO anon, authenticated USING (true);

-- AI 일일 리포트 (Phase 6)
DROP POLICY IF EXISTS "누구나 읽기" ON daily_reports;
CREATE POLICY "누구나 읽기" ON daily_reports
    FOR SELECT TO anon, authenticated USING (true);


-- ============================================================================
--  4. 개인정보가 담긴 표는 잠근 채로 둡니다
-- ============================================================================
--  profiles     : 계정 정보
--  public_links : 공유 링크의 비밀 주소값
--
--  읽기 규칙을 하나도 만들지 않았으므로 공개용 열쇠로는 아무것도 안 보입니다.
--  Phase 5(로그인 기능)에서 "본인 것만 보이게" 하는 규칙을 추가할 예정입니다.
-- ============================================================================
-- (의도적으로 비워 둠)


-- ============================================================================
--  5. 제대로 됐는지 확인하기
-- ============================================================================
--  아래를 실행하면 표별로 보안이 켜졌는지, 읽기 규칙이 몇 개인지 나옵니다.
--
--    · rls_켜짐   이 전부 true 여야 합니다
--    · 읽기규칙   위 9개 표는 1, profiles/public_links 는 0 이어야 합니다
-- ============================================================================
SELECT
    c.relname                                   AS "표 이름",
    c.relrowsecurity                            AS "rls_켜짐",
    count(p.polname) FILTER (WHERE p.polcmd = 'r') AS "읽기규칙"
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
      'stores', 'categories', 'books', 'store_books', 'book_matches',
      'rankings', 'book_meta', 'crawl_logs', 'daily_reports',
      'profiles', 'public_links'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
