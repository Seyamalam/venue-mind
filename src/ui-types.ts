import type { ReactNode, SyntheticEvent } from "react";
import type { AccountSnapshot, AccountUser, createAccountStore } from "./auth/account-store";
import type { VenueComment } from "./domain/comments";
import type { VenuePlan, VenueProposal } from "./domain/geometry";
import type { ProposalBranch } from "./domain/venue-planner";
import type { BrowserModelContext } from "./webmcp/register-venue-tools";

export type DomainScalar = string | number | boolean | null;
export type DomainValue = DomainScalar | DomainRecord | DomainList;
export type DomainRecord = { readonly [field: string]: DomainValue };
export type DomainList = DomainRecord[];
export type ValueOption = { value: string; label: string };
export type VoidCallback = () => void;
export type ValueCallback<T = string> = (value: T) => void;
export type AsyncValueCallback<T = string, R = void> = (value: T) => Promise<R> | R;
export type PinEvent = SyntheticEvent<SVGGElement>;
export type CommentsState = {
  comments: VenueComment[];
  branches: ProposalBranch[];
  plan: VenuePlan;
  proposal: VenueProposal;
};

export type ReadyAccountSnapshot = Readonly<AccountSnapshot> & {
  readonly status: "ready";
  readonly user: AccountUser;
  readonly activeOrganizationId: string;
};

export type WorkspaceRenderContext = {
  account: ReadyAccountSnapshot;
  accountStore: ReturnType<typeof createAccountStore>;
  organizationId: string;
};

export type WorkspaceGateProps = {
  children: (context: WorkspaceRenderContext) => ReactNode;
};

declare global {
  interface Document {
    modelContext?: BrowserModelContext;
  }
}
