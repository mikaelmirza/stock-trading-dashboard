"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Zero-friction guest bootstrap (SPEC §6): POSTing to the Route Handler is
// what actually sets the httpOnly session cookie — a Server Component render
// can't call cookies().set() itself (only Server Actions/Route Handlers
// can), so this client-side POST-then-redirect is the entry point that
// creates the guest session before landing on /dashboard.
export default function GuestProvision() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    fetch("/api/session", { method: "POST" })
      .then(() => {
        if (!cancelled) router.replace("/dashboard");
      })
      .catch(() => {
        // No dedicated error UI for this bootstrap step — a reload retries.
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <p>Setting up your trading account…</p>
    </div>
  );
}
