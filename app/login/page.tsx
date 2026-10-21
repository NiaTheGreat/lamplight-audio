export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main>
      <h1>Audiobook Generator</h1>
      <form className="panel" method="post" action="/api/login">
        <input type="password" name="password" placeholder="Password" autoFocus required />
        <div className="row">
          <button type="submit" className="grow">
            Unlock
          </button>
        </div>
        {error ? <p className="error">That password didn&apos;t match.</p> : null}
      </form>
    </main>
  );
}
