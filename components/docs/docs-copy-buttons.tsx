"use client";

import { useState } from "react";
import { CheckCircle, Copy, LinkSimple } from "@phosphor-icons/react";

export function CopyTextButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return <button type="button" onClick={copy}><Copy size={14} />{copied ? "Copied" : "Copy"}</button>;
}

export function CopyDeepLinkButton({ href, title }: { href: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(new URL(href, window.location.origin).href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button type="button" onClick={copy} aria-label={`Copy link to ${title}`} title={copied ? "Copied" : "Copy deep link"}>
      {copied ? <CheckCircle size={16} weight="fill" /> : <LinkSimple size={16} />}
    </button>
  );
}
