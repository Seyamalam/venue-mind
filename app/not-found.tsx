import Link from "next/link";
import { RouteState } from "@/components/route-state";

export default function NotFound() {
  return <RouteState state="empty" label="404" role="main" action={<Link href="/projects">PROJECTS</Link>} />;
}
