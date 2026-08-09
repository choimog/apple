import NameDetailPage from "@/components/NameDetailPage";


export default function Page(props: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ period?: string; cat?: string; date?: string }>;
}) {
  return <NameDetailPage kind="publisher" {...props} />;
}
