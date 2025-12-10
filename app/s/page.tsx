// /workspaces/Vext/app/s/page.tsx
import { redirect } from "next/navigation";

/**
 * Legacy share redirect.
 * We no longer use /s in new shares, but if an old /s?id=... link is opened,
 * send the user straight to /video/:id instead of showing an extra page.
 */
export default async function ShareRedirect(props: any) {
  // Next 15 sometimes passes searchParams as a Promise, so we just await it.
  const searchParams = await props.searchParams;
  const id = (searchParams?.id as string | undefined) || "";

  if (id) {
    redirect(`/video/${encodeURIComponent(id)}`);
  }

  redirect("/");
}