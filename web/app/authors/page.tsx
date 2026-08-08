import NameRankingPage from "@/components/NameRankingPage";

export const revalidate = 600;

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  return <NameRankingPage kind="author" searchParams={searchParams} />;
}
