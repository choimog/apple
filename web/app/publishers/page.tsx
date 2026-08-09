import NameRankingPage from "@/components/NameRankingPage";

export const metadata = { title: "출판사별 순위" };


export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  return <NameRankingPage kind="publisher" searchParams={searchParams} />;
}
