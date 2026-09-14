import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";

export default async function Root() {
  const user = await currentUser();
  redirect(user ? "/today" : "/sign-in");
}
