import { getDashboardData, getDb } from "@tracker/core";
import { Dashboard } from "@/components/Dashboard";
import { todayParis } from "@/lib/deadlines";

export const dynamic = "force-dynamic";

export default function Page() {
  const data = getDashboardData(getDb());
  return <Dashboard data={data} today={todayParis()} />;
}
