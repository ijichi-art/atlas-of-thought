import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getUserChatProvider } from "@/lib/api-keys";
import { ApiKeyForm } from "./ApiKeyForm";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [keys, activeProvider] = await Promise.all([
    prisma.apiKey.findMany({
      where: { userId },
      select: { provider: true, hint: true, model: true, label: true, lastUsedAt: true },
    }),
    getUserChatProvider(userId),
  ]);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-2xl mx-auto px-8 py-16">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
          ← Back
        </Link>
        <h1 className="text-2xl font-serif mt-4 mb-2">Settings</h1>
        <p className="text-sm text-stone-500 mb-10">
          API keys are encrypted with AES-256-GCM before storage. The browser only sees them during
          submission. You choose which provider and model to use — costs go to your own account.
        </p>

        <section>
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-4">
            AI provider &amp; model (BYOK)
          </h2>
          <ApiKeyForm
            initialKeys={keys}
            initialActiveProvider={activeProvider}
          />
          <p className="mt-4 text-xs text-stone-400 space-y-0.5">
            <span className="block">
              Anthropic: <a className="underline" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>
            </span>
            <span className="block">
              OpenAI: <a className="underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>
            </span>
            <span className="block">
              DeepSeek: <a className="underline" href="https://platform.deepseek.com" target="_blank" rel="noreferrer">platform.deepseek.com</a>
            </span>
          </p>
        </section>
      </div>
    </main>
  );
}
