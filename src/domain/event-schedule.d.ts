export declare const RFC3339_INSTANT_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{3})?(?:Z|(?!-00:00)[+-]\\d{2}:\\d{2})$";
export declare function assertRfc3339Instant(value: any, label?: any): any;
export declare function normalizeEventSchedule(schedule: any, { label, nullable }?: any): {
    startAt: any;
    endAt: any;
    timezone: any;
} | null;
