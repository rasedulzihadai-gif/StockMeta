import Workspace from "@/components/Workspace";
import { getInitialData } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const initial = await getInitialData();
  return <Workspace initial={initial} />;
}
