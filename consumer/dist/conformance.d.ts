export interface ConformanceCheck {
    name: string;
    pass: boolean;
    detail?: string;
}
export interface ConformanceReport {
    origin: string;
    checks: ConformanceCheck[];
    allPassed: boolean;
}
export declare function runConformanceChecks(origin: string, fetchImpl?: typeof fetch): Promise<ConformanceReport>;
