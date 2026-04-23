import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAnthropicKeyMeta } from "@/lib/api-keys";
import { ApiKeyForm } from "./ApiKeyForm";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const meta = await getAnthropicKeyMeta(session.user.id);

  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-2xl mx-auto px-8 py-16">
        <Link href="/" className="text-sm text-stone-500 hover:text-stone-800">
          ← Back
        </Link>
        <h1 className="text-2xl font-serif mt-4 mb-2">Settings</h1>
        <p className="text-sm text-stone-500 mb-12">
          Your Anthropic API key is encrypted with AES-256-GCM before being stored.
          We never log it, and the browser only sees it during submission.
        </p>

        <section>
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-4">
            Anthropic API key (BYOK)
          </h2>
          {meta ? (
            <div className="mb-6 text-sm text-stone-700 p-4 bg-white border border-stone-200 rounded">
              <div>
                Key on file:{" "}
                <code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">{meta.hint}</code>
                {meta.label ? ` — ${meta.label}` : ""}
              </div>
              <div className="text-xs text-stone-400 mt-1">
                Saved {meta.createdAt.toLocaleString()}
                {meta.lastUsedAt ? ` · Last used ${meta.lastUsedAt.toLocaleString()}` : " · Never used"}
              </div>
            </div>
          ) : (
            <p className="mb-6 text-sm text-stone-400">No key saved yet.</p>
          )}
          <ApiKeyForm hasExisting={!!meta} />
          <p className="mt-3 text-xs text-stone-400">
            Get a key at <a className="underline" href="https://console.anthropic.com" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
