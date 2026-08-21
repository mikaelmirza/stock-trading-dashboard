import { redirect } from "next/navigation";
import { verifySession } from "@/app/lib/dal";
import GuestProvision from "./guest-provision";

// SPEC §1's "reviewer opens the link and is immediately trading" goal: an
// already-authenticated visitor redirects straight through server-side, a
// fresh visitor gets a guest session provisioned (GuestProvision) before
// landing on /dashboard.
export default async function Home() {
  const session = await verifySession();
  if (session) {
    redirect("/dashboard");
  }

  return <GuestProvision />;
}
