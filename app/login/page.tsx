export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="eyebrow">Audiobook generator</div>
      <h1 className="display">Lamplight</h1>
      <form method="post" action="/api/login">
        <input type="password" name="password" placeholder="Password" autoFocus required aria-label="Password" />
        <button type="submit" className="btn primary block">
          Unlock
        </button>
        {error ? <p className="error" role="alert">That password didn&apos;t match.</p> : null}
      </form>
    </main>
  );
}
