export declare const LOCK_TYPES: readonly string[];
export declare const LOCK_SOURCES: readonly string[];
export declare function normalizeObjectLocks(object: any, fallback?: any): any;
export declare function normalizeProjectLocks(locks?: any, plan?: any): any[];
export declare function detectLockConflicts(plan: any, changes?: any, projectLocks?: any): any[];
export declare function assertNoLockConflicts(plan: any, changes?: any, projectLocks?: any): any;
