import NameDetailPage from "@/components/NameDetailPage";

export const revalidate = 600;

export default function Page(props: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  return <NameDetailPage kind="author" {...props} />;
}
