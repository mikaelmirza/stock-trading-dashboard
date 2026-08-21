import { redirect } from "next/navigation";
import { getUser } from "@/app/lib/dal";

// Proxy (project root) already redirects an unauthenticated request away
// from /dashboard before it gets here (cookie-only check, no DB read). This
// layout is the defense-in-depth check against the DB itself: a session
// cookie can decrypt fine yet reference a user row that's gone (e.g. a
// pruned guest, PLAN §6.2), which Proxy has no way to catch. Bounce back to
// `/`, which owns guest (re-)provisioning — this layout can't create a
// session cookie itself, since Next.js only allows cookie writes from a
// Server Action or Route Handler, not a Server Component render.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) {
    redirect("/");
  }

  return <>{children}</>;
}
