import { AdapterContractError } from "./contracts.ts";
export declare function normalizeRetryAfter(value: any, { now, maximumRetryAfterMs, }?: any): any;
export declare function adapterHttpError(responseOrCause: any, options?: any): AdapterContractError;
