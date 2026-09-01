import { AdapterContractError } from "./contracts.ts";
export declare function createVenueAdapter(definitionInput: any, handlers: any): Readonly<{
    definition: Readonly<{
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
    invoke(capability: any, input: any, context: any): Promise<any>;
}>;
export declare function createAdapterRuntime(options?: any): Readonly<{
    execute(adapter: any, capability: any, input: any, authorization?: any): Promise<{
        status: string;
        invocationId: string;
        attempts: any;
        duplicateOf: any;
        output: any;
        deadLetter?: never;
        error?: never;
    } | {
        status: string;
        invocationId: string;
        attempts: any;
        output: any;
        duplicateOf?: never;
        deadLetter?: never;
        error?: never;
    } | {
        status: string;
        invocationId: string;
        attempts: any;
        deadLetter: Readonly<{
            schemaVersion: 1;
            id: `${string}-dead-letter`;
            adapterId: any;
            adapterVersion: any;
            capability: any;
            inputChecksum: string;
            failedAt: string;
            attempts: any;
            terminalCode: string;
        }>;
        error: AdapterContractError;
        duplicateOf?: never;
        output?: never;
    }>;
    acceptWebhook(adapter: any, input: any, authorization?: any): Promise<{
        status: string;
        invocationId: string;
        attempts: any;
        duplicateOf: any;
        output: any;
        deadLetter?: never;
        error?: never;
    } | {
        status: string;
        invocationId: string;
        attempts: any;
        output: any;
        duplicateOf?: never;
        deadLetter?: never;
        error?: never;
    } | {
        status: string;
        invocationId: string;
        attempts: any;
        deadLetter: Readonly<{
            schemaVersion: 1;
            id: `${string}-dead-letter`;
            adapterId: any;
            adapterVersion: any;
            capability: any;
            inputChecksum: string;
            failedAt: string;
            attempts: any;
            terminalCode: string;
        }>;
        error: AdapterContractError;
        duplicateOf?: never;
        output?: never;
    } | {
        status: string;
        output: any;
        invocationId: string;
        attempts: any;
        deadLetter: Readonly<{
            schemaVersion: 1;
            id: `${string}-dead-letter`;
            adapterId: any;
            adapterVersion: any;
            capability: any;
            inputChecksum: string;
            failedAt: string;
            attempts: any;
            terminalCode: string;
        }>;
        error: AdapterContractError;
        duplicateOf?: never;
    }>;
    inspectRateLimit(adapter: any): any;
}>;
export declare function createMemoryDeadLetterSink(): Readonly<{
    add(item: any): Promise<void>;
    list(): any;
}>;
export declare function verifySyncCursor(definition: any, cursor: any): Promise<any> | null;
export declare const serializeDeadLetter: (deadLetter: any) => string;
