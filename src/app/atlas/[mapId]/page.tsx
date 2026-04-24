import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TerraformPanel } from "./TerraformPanel";
import { SharePanel } from "./SharePanel";
import { MapTitle } from "./MapTitle";
import { AtlasView } from "./AtlasView";

export default async function UserAtlasPage({ params }: { params: Promise<{ mapId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { mapId } = await params;

  const map = await prisma.map.findFirst({
    where: { id: mapId, userId },
    select: {
      id: true,
      title: true,
      _count: { select: { conversations: true, cities: true } },
    },
  });
  if (!map) redirect("/");

  return (
    <div className="h-screen flex flex-col">
      <header className="px-6 py-3 border-b border-stone-200 bg-stone-50 flex items-center justify-between text-sm flex-none">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-stone-500 hover:text-stone-800">
            ← Home
          </Link>
          <MapTitle mapId={map.id} initial={map.title} />
          <span className="text-stone-400 text-xs">
            {map._count.conversations} conversations · {map._count.cities} cities
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SharePanel mapId={map.id} />
          <TerraformPanel
            mapId={map.id}
            conversationCount={map._count.conversations}
            cityCount={map._count.cities}
          />
        </div>
      </header>
      <div className="flex-1 min-h-0">
        <AtlasView mapId={map.id} cityCount={map._count.cities} />
      </div>
    </div>
  );
}
