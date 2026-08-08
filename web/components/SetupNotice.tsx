/**
 * 데이터베이스 기능(db/perf.sql)이 아직 안 켜졌을 때 보여주는 안내.
 *
 * 【왜 조용히 넘어가지 않나요?】
 * 이 기능이 없으면 어떤 화면은 느리고, 어떤 화면(출판사·저자·분야 분석)은
 * 아예 값을 못 만듭니다. 그걸 "데이터가 없습니다" 로 보여주면 거짓말입니다.
 * 데이터는 있는데 계산 기능이 없는 것이므로, 그대로 알려드립니다.
 */
export default function SetupNotice({ what }: { what?: string }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">
        ⚙️ 데이터베이스 계산 기능을 한 번 켜주셔야 합니다
      </p>
      {what && <p className="mt-1">{what}</p>}
      <p className="mt-2">
        <strong>방법 (한 번만, 2분, 0원):</strong> Supabase → SQL Editor → New
        query 에 저장소의{" "}
        <code className="rounded bg-amber-100 px-1 font-mono text-xs">
          db/perf.sql
        </code>{" "}
        전체를 붙여넣고 <strong>Run</strong> 을 누르세요.
        사이트를 다시 배포할 필요는 없습니다.
      </p>
      <p className="mt-1.5 text-xs text-amber-800">
        여러 번 실행해도 안전하고, 데이터는 하나도 바뀌지 않습니다.
      </p>
    </div>
  );
}
