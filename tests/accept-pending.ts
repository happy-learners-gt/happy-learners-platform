/** DEC-046: 0046 publishes terms and privacy in org-demo. New accounts must sign them before anything else. */
export async function acceptPending(origin: string, cookie: string | null, fullName: string, password: string) {
  if (!cookie) return;
  const session = await (await fetch(`${origin}/api/session`, { headers: { Cookie: cookie, Origin: origin } })).json() as { pending?: { id: string }[] };
  if (!session.pending?.length) return;
  const response = await fetch(`${origin}/api/legal/accept`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ documentIds: session.pending.map(item => item.id), signature: { fullName, password } }),
  });
  if (response.status !== 200) throw new Error(await response.text());
}
