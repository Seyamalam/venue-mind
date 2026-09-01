export declare function normalizePlanningEffectBindings(input: any, requirements?: any): any;
export declare function normalizeEventBrief(brief: any, fallback?: any): {
    planningEffectBindings?: any;
    id: any;
    eventName: any;
    date: any;
    timezone: any;
    venueId: any;
    roomId: any;
    attendeeTarget: any;
    occupancyMode: any;
    schedule: any;
    requirements: any;
};
export declare function eventBriefWithCoverage(brief: any, validation: any, acceptedValidation?: any): any;
