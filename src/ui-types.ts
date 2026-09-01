import type { FormEvent, ReactNode, SyntheticEvent } from "react";

/** Permissive UI boundary while domain records gain dedicated public interfaces. */
export type DomainRecord = Record<string, any>;
export type DomainList = DomainRecord[];
export type ValueOption = { value: string; label: string };
export type VoidCallback = () => void;
export type ValueCallback<T = string> = (value: T) => void;
export type AsyncValueCallback<T = string> = (value: T) => Promise<unknown> | unknown;
export type FormHandler = (event: FormEvent<HTMLFormElement>) => void;
export type PinEvent = SyntheticEvent<SVGGElement>;
export type CommentsState = DomainRecord & { comments: DomainList; branches: DomainList; plan: DomainRecord; proposal: DomainRecord };

export type WorkspaceRenderContext = {
  account: DomainRecord;
  accountStore: DomainRecord;
  organizationId: string;
};

export type WorkspaceGateProps = {
  children: (context: WorkspaceRenderContext) => ReactNode;
};

declare global {
  interface Document {
    modelContext?: DomainRecord;
  }
}
