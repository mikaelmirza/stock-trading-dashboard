import { verifySession } from "@/app/lib/dal";
import { deleteSession } from "@/app/lib/session";

export async function POST() {
  const session = await verifySession();
  if (!session) {
    return new Response(null, { status: 401 });
  }

  await deleteSession();
  return new Response(null, { status: 204 });
}
