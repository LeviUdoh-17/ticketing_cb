import { Suspense } from "react";
import { TicketForm } from "@/components/TicketForm";
import { resolveSource } from "@/lib/validation";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Technical support
      </h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Tell us what&apos;s going wrong and we&apos;ll get back to you by email.
      </p>
      <div className="mt-8">
        <Suspense fallback={null}>
          <SourcedForm searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SourcedForm({
  searchParams,
}: Pick<PageProps<"/">, "searchParams">) {
  const { source } = await searchParams;
  return (
    <TicketForm
      source={resolveSource(Array.isArray(source) ? source[0] : source)}
      // Public by design (it's embedded in the page); read per request so it
      // can be set on the host without rebuilding.
      turnstileSiteKey={process.env.TURNSTILE_SITE_KEY || undefined}
    />
  );
}
