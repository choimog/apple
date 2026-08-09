import NameRankingPage from "@/components/NameRankingPage";

export const metadata = { title: "저자별 순위" };


export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  return <NameRankingPage kind="author" searchParams={searchParams} />;
}
