-- ============================================================================
--  [강제로 묶기] 를 쓸 수 있게 문을 한 칸만 엽니다
-- ============================================================================
--
--  【왜 필요한가요? — 2026-08-12 대표님 요청】
--
--    "다르다고 매칭된 것 중에 내가 수동으로 이어주고 싶은 게 있거든?
--     모든 걸 규정화할 수는 없으니까."
--
--  맞습니다. 예를 들어 이런 짝은 규칙상 반드시 갈라집니다.
--
--      안녕이라 그랬어 (집 에디션)        김애란 · 문학동네 · 2025-06 · 16,800원
--      안녕이라 그랬어(집에디션 리커버)    김애란 · 문학동네 · 2025-06 · 16,800원
--
--  저자·출판사·출간월·정가가 전부 같은데 「리커버」 한 단어 때문에
--  갈립니다. 규칙이 고장 난 게 아니라, 대표님이 정하신
--  "개정판·리커버·양장본은 별도 도서" 규칙이 그대로 작동한 것입니다.
--  그러니 규칙을 푸는 게 아니라 **사람이 예외를 만드는 자리**가 맞습니다.
--
--  【지금은 왜 안 되나요?】
--  사이트는 book_matches 표에서 '판정' 칸만 고칠 수 있습니다.
--  **새 줄을 만들 권한은 일부러 안 줬습니다.** 그런데 규칙이 거부한
--  짝은 아예 저장돼 있지 않아서, 고칠 줄 자체가 없습니다.
--
--  【이 파일이 여는 것 — 딱 이만큼입니다】
--    · book_matches 표에 **새 줄 만들기**만
--    · role='admin' 인 사람만
--    · 판정이 'manual_merge'(같은 책) 인 줄만 — 다른 판정은 못 만듭니다
--    · 원래판단이 'rejected' 인 줄만 — 되돌리기가 되도록
--    · 누가 눌렀는지는 **로그인한 본인 이름만** — 남의 이름 못 씀
--    · 지우기는 여전히 못 합니다
--
--  【어떻게 실행하나요?】
--    Supabase → 왼쪽 [SQL Editor] → [New query] → 이 파일 전체 붙여넣기
--    → 오른쪽 아래 [Run]
--    맨 아래에 확인 표가 한 개 나옵니다. 전부 ✅ 면 끝입니다.
--
--  ⚠️ 여러 번 실행해도 안전합니다 (같은 것을 다시 만들 뿐입니다).
-- ============================================================================


-- ----------------------------------------------------------------------------
--  1. 새 줄을 만들 때 쓸 칸만 허용합니다 (표 전체가 아닙니다)
-- ----------------------------------------------------------------------------
GRANT INSERT (
    store_book_a, store_book_b, score, reasons,
    decision, auto_decision, decided_by, decided_at
) ON book_matches TO authenticated;


-- ----------------------------------------------------------------------------
--  2. 그중에서도 '관리자가 같은 책이라고 이어 붙이는 줄' 만 허용합니다
-- ----------------------------------------------------------------------------
--  WITH CHECK 는 "이런 줄만 만들 수 있다" 는 조건입니다.
--  화면에서 보내는 값을 그대로 믿지 않고 데이터베이스가 다시 봅니다.
--
--  auto_decision = 'rejected' 로 못 박는 이유:
--    이 줄은 '기계는 안 이어줬는데 사람이 이어 붙인 것' 입니다.
--    나중에 [되돌리기] 를 누르면 기계 판단인 '다른 책' 으로 돌아가고,
--    그러면 이 줄은 어느 목록에도 안 나옵니다. 즉 없던 일이 됩니다.
--    이 값이 비어 있으면 되돌리기가 거부됩니다(되돌릴 곳을 모르니까).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "관리자만 강제로 이어붙이기" ON book_matches;
CREATE POLICY "관리자만 강제로 이어붙이기" ON book_matches
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin()
        AND decision      = 'manual_merge'
        AND auto_decision = 'rejected'
        AND decided_by    = auth.uid()
    );


-- ----------------------------------------------------------------------------
--  3. 확인 — 제대로 열렸는지 봅니다
-- ----------------------------------------------------------------------------
--  ⚠️ 결과 표는 **하나만** 나오게 만들었습니다. Supabase 화면은 여러 표를
--    보내면 마지막 것만 보여줘서, 앞의 결과를 못 보고 지나칩니다.
-- ----------------------------------------------------------------------------
WITH ins_cols AS (
    SELECT count(*) AS v
      FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND table_name = 'book_matches'
       AND grantee = 'authenticated' AND privilege_type = 'INSERT'
       AND column_name IN ('store_book_a', 'store_book_b', 'score', 'reasons',
                           'decision', 'auto_decision', 'decided_by', 'decided_at')
),
pol AS (
    SELECT count(*) AS v
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'book_matches'
       AND policyname = '관리자만 강제로 이어붙이기'
),
del AS (
    SELECT count(*) AS v
      FROM information_schema.table_privileges
     WHERE table_schema = 'public' AND table_name = 'book_matches'
       AND grantee = 'authenticated' AND privilege_type = 'DELETE'
),
admins AS (SELECT count(*) AS v FROM profiles WHERE role = 'admin')
SELECT * FROM (
    SELECT 1 AS "번호", '새 줄을 만들 수 있는 칸' AS "확인 항목",
           (SELECT v FROM ins_cols) || ' / 8개' AS "결과",
           CASE WHEN (SELECT v FROM ins_cols) = 8
                THEN '✅ 열렸습니다'
                ELSE '❌ 이 파일을 다시 실행하세요' END AS "판정"
    UNION ALL
    SELECT 2, '관리자만·같은책만 이어붙이는 규칙',
           (SELECT v FROM pol) || '개',
           CASE WHEN (SELECT v FROM pol) = 1
                THEN '✅ 걸려 있습니다'
                ELSE '❌ 규칙이 없습니다. 아무나 만들 수 있게 되면 안 됩니다' END
    UNION ALL
    SELECT 3, '지우기는 여전히 막혀 있는가',
           (SELECT v FROM del) || '개',
           CASE WHEN (SELECT v FROM del) = 0
                THEN '✅ 막혀 있습니다'
                ELSE '🚨 지우기가 열려 있습니다. 저에게 알려 주세요' END
    UNION ALL
    SELECT 4, '관리자 계정 수',
           (SELECT v FROM admins) || '명',
           CASE WHEN (SELECT v FROM admins) >= 1
                THEN '✅'
                ELSE '⚠️ 관리자가 없으면 버튼이 안 먹습니다' END
) t ORDER BY "번호";
