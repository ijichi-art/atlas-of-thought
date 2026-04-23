import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";

export default async function Home() {
  const session = await auth();

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
            ChatGPT, Claude, or Claude Code, and watch them grow into countries,
            cities, and roads — terrain you can explore.
          </p>
          <p className="mt-3 text-xs text-stone-400">Phase 0 — foundations</p>
        </section>

        {session?.user ? (
          <section className="space-y-4">
            <h2 className="text-sm uppercase tracking-wider text-stone-500">Get started</h2>
            <ul className="space-y-2 text-stone-700">
              <li>
                <Link href="/settings" className="underline hover:text-stone-900">
                  → Add your Anthropic API key (BYOK)
                </Link>
              </li>
              <li className="text-stone-400">
                → Import past conversations <em>(Phase 2)</em>
              </li>
              <li>
                <Link href="/atlas" className="underline hover:text-stone-900">
                  → View the demo atlas <em className="text-stone-400">(static, Phase 1 PR-1)</em>
                </Link>
              </li>
            </ul>
          </section>
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
