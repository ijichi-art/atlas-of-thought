import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ImportForm } from "./ImportForm";

export const metadata = { title: "Import — Atlas of Thought" };

export default async function ImportPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  let maps = await prisma.map.findMany({
    where: { userId },
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
  });

  // Auto-create the first map so the import form always has something to write to.
  if (maps.length === 0) {
    const created = await prisma.map.create({
      data: { userId, title: "My Atlas" },
      select: { id: true, title: true },
    });
    maps = [created];
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-2xl mx-auto px-8 py-16">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
          ← Back
        </Link>
        <h1 className="text-2xl font-serif mt-4 mb-2">Import Conversations</h1>
        <p className="text-sm text-stone-500 mb-10">
          Drag in a ChatGPT or Claude export, paste a transcript, or drop a Claude Code session log.
          Conversations are stored in your atlas and will appear on the map after layout (coming soon).
        </p>
        <ImportForm maps={maps} />
      </div>
    </main>
  );
}
