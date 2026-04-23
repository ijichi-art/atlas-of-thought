import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="max-w-sm w-full p-8 bg-white border border-stone-200 rounded-lg shadow-sm">
        <h1 className="text-2xl font-serif text-stone-800 mb-1">Atlas of Thought</h1>
        <p className="text-sm text-stone-500 mb-6">Sign in to start charting your thinking.</p>
        <form
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full py-2 px-4 bg-stone-800 text-white rounded hover:bg-stone-700 transition"
          >
            Continue with GitHub
          </button>
        </form>
        <p className="mt-6 text-xs text-stone-400">
          No account is created until you sign in. Your data stays in your database.
        </p>
      </div>
    </main>
  );
}
