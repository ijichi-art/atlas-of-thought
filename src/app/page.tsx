import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MapList } from "./MapList";

export default async function Home() {
  const session = await auth();

  let maps: { id: string; title: string; _count: { conversations: number; cities: number } }[] = [];
  if (session?.user?.id) {
    maps = await prisma.map.findMany({
      where: { userId: session.user.id },
      select: { id: true, title: true, _count: { select: { conversations: true, cities: true } } },
      orderBy: { updatedAt: "desc" },
    });
  }

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-3xl mx-auto px-8 py-16">
        <header className="flex items-center justify-between mb-16">
          <h1 className="text-2xl font-serif">Atlas of Thought</h1>
          {session?.user ? (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-stone-500">{session.user.email ?? session.user.name}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button type="submit" className="underline text-stone-600 hover:text-stone-900">
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("github", { redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="text-sm py-1.5 px-3 bg-stone-800 text-white rounded hover:bg-stone-700"
              >
                Sign in
              </button>
            </form>
          )}
        </header>

        <section className="mb-12">
          <p className="text-lg leading-relaxed text-stone-700 max-w-prose">
            Turn your AI conversations into a living map. Import past chats from
            ChatGPT, Claude, or Claude Code — Claude clusters them into countries,
            cities, and roads you can explore and continue from the map.
          </p>
        </section>

        {session?.user ? (
          <div className="space-y-10">
            <MapList maps={maps} />

            <section>
              <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-3">Actions</h2>
              <ul className="space-y-2 text-sm text-stone-700">
                <li>
                  <Link href="/import" className="underline hover:text-stone-900">
                    → Import conversations
                  </Link>
                </li>
                <li>
                  <Link href="/settings" className="underline hover:text-stone-900">
                    → Settings (API key, model)
                  </Link>
                </li>
                <li>
                  <Link href="/atlas" className="underline hover:text-stone-900 text-stone-500">
                    → Demo atlas (static)
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        ) : (
          <section className="space-y-3 text-sm">
            <p className="text-stone-500">Sign in to start charting your thinking.</p>
            <p>
              <Link href="/atlas" className="underline text-stone-700 hover:text-stone-900">
                → View the demo atlas
              </Link>{" "}
              <span className="text-stone-400">(no sign-in needed)</span>
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
