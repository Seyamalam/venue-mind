import type { Metadata } from "next";
import "../../src/docs.css";

export const metadata: Metadata = {
  title: { default: "VenueMind Docs", template: "%s · VenueMind Docs" },
};

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
