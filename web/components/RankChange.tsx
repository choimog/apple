/**
 * 순위 등락 표시.
 *
 * 【지키는 것】
 * 어제 데이터가 없으면 "-" 로 둡니다. 0이나 '변동없음'으로 지어내지 않습니다.
 */
export default function RankChange({
  change,
  isNew,
}: {
  change: number | null;
  isNew: boolean;
}) {
  if (isNew) {
    return (
      <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">
        NEW
      </span>
    );
  }
  if (change === null) {
    return (
      <span className="text-xs text-slate-400" title="비교할 이전 수집 기록이 없습니다">
        –
      </span>
    );
  }
  if (change === 0) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const up = change > 0;
  return (
    <span
      className={`text-xs font-medium ${up ? "text-red-600" : "text-blue-600"}`}
      title={up ? `${change}계단 상승` : `${-change}계단 하락`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(change)}
    </span>
  );
}
