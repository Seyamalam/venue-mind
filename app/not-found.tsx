import Link from "next/link";

export default function NotFound() {
  return (
    <main className="route-state" role="main">
      <strong>404</strong>
      <Link href="/projects">PROJECTS</Link>
    </main>
  );
}
