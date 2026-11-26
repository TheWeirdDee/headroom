import { Link } from 'react-router';

export function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">There is nothing at this address.</p>
      <Link to="/" className="mt-6 inline-block text-accent hover:underline">
        Back to the start
      </Link>
    </div>
  );
}
