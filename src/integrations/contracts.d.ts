export declare const ADAPTER_CONTRACT_VERSION = 1;
export declare const ADAPTER_CAPABILITIES: readonly string[];
export declare const ADAPTER_IMPORT_RESULT_MODES: readonly string[];
export declare const ADAPTER_CHANGE_OPERATIONS: readonly string[];
export declare const VENUE_ENTITY_TYPES: readonly string[];
export declare const ADAPTER_EVIDENCE_LIMITS: Readonly<{
    kindLength: 80;
    sourceIdLength: 160;
    referenceLength: 160;
    references: 20;
}>;
export declare class AdapterContractError extends Error {
    readonly code: string;
    readonly details: any;
    constructor(code: any, message: any, details?: any);
}
export declare const assertIsoTimestamp: (value: any, label?: any) => string | undefined;
export declare const canonicalStringify: (value: any) => string;
export declare function sha256Checksum(value: any): Promise<string>;
export declare function defineAdapter(input: any): Readonly<{
    contractVersion: 1;
    id: any;
    displayName: any;
    version: any;
    capabilities: any;
    importResultMode: any;
    scopes: {
        [k: string]: any;
    };
    retryPolicy: any;
    rateLimit: any;
}>;
export declare function normalizeRetryPolicy(input?: any): any;
export declare function normalizeRateLimit(input?: any): any;
export declare function assertAdapterScope(definition: any, capability: any, grantedScopes?: any): boolean;
export declare function normalizeExternalReference(input: any, definition: any): any;
export declare function normalizeAdapterChange(input: any, definition: any): any;
export declare function normalizeSyncCursor(input: any, definition: any): any;
export declare function createSyncCursor(definition: any, { opaque, sourceVersion }: any): Promise<any>;
export declare function adapterInvocationId(definition: any, capability: any, input: any): string;
