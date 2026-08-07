/**
 * 데이터를 못 불러왔을 때 보여주는 화면.
 *
 * 【왜 필요한가요?】
 * 데이터베이스가 잠깐 느리거나 접속이 안 될 때, 화면 전체가 깨지면 안 됩니다.
 * 또 "데이터가 0건" 처럼 보이게 만들어서도 안 됩니다.
 * 그건 사실이 아니고, 진짜로 0건인 상황과 구분이 안 되기 때문입니다.
 *
 * 그래서 "지금 못 불러왔다" 는 사실을 그대로 보여줍니다.
 */
export default function DataError({ detail }: { detail?: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6">
      <h1 className="text-base font-bold text-amber-900">
        데이터를 불러오지 못했습니다
      </h1>
      <p className="mt-2 text-sm text-amber-800">
        데이터가 없는 것이 아니라, <strong>지금 불러오지 못한 것</strong>입니다.
        잠시 후 새로고침해 주세요.
      </p>
      <p className="mt-2 text-sm text-amber-800">
        계속 이 화면이 나오면 아래를 확인하세요.
      </p>
      <ul className="mt-1 list-inside list-disc text-sm text-amber-800">
        <li>Supabase 대시보드에서 프로젝트가 켜져 있는지</li>
        <li>
          Vercel → Settings → Environment Variables 에{" "}
          <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
          과{" "}
          <code className="rounded bg-amber-100 px-1">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>{" "}
          가 등록돼 있는지
        </li>
      </ul>
      {detail && (
        <p className="mt-3 break-all rounded bg-amber-100 px-2 py-1 font-mono text-xs text-amber-900">
          {detail}
        </p>
      )}
    </div>
  );
}
