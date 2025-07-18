const SCHEMA_VERSION = 'SFUv1.1';

// the type in source_data/vital_data.json
interface CourseCondensedInfo {
    department: string;
    number: string;
    title: string;
    notes: string;
    prerequisites: string;
    corequisites: string;
}



interface LLMError {
    error: true;
    reason: string;
}

interface LLMParseOutput {
    department: string;
    number: string;
    schema_version: string;
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];
}

export type LLMResponse = LLMParseOutput | LLMError;



interface ConflictEquivalentCourse {
    type: 'conflict_course';
    department: string;
    number: string;
    title?: string;
}

interface ConflictOther {
    type: 'conflict_other';
    note: string;
}

type CreditConflict = ConflictEquivalentCourse | ConflictOther;

// Simplified interface for LLM parsing (without metadata fields)
interface ParsedCourseRequirements {
    department: string;
    number: string;
    schema_version: string;
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];
    rawResponse?: string;
}

// data that is saved to file
interface SaveCourseRequirements {
    department: string;
    number: string;
    // Original course data
    original_title: string;
    original_prerequisites: string;
    original_corequisites: string;
    original_notes: string;


    schema_version: string;
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];

    timestamp: string; // ISO 8601 format
}


interface RequirementGroup {
    type: 'group';
    logic: 'ALL_OF' | 'ONE_OF' | 'TWO_OF';
    children: RequirementNode[];
}

type RequirementNode = RequirementGroup | RequirementProgram | RequirementCGPA | RequirementUDGPA | RequirementCourse | RequirementHSCourse | RequirementCreditCount | RequirementCourseCount | RequirementPermission | RequirementOther;

interface RequirementProgram {
    type: 'program';
    program: string;
}

interface RequirementCGPA {
    type: 'CGPA';
    minCGPA: number;
}

interface RequirementUDGPA {
    type: 'UDGPA';
    minUDGPA: number;
}

interface RequirementHSCourse {
    type: 'HSCourse';
    course: string;
    minGrade?: string;
    orEquivalent?: 'true';
}

interface RequirementCourse {
    type: 'course';
    department: string;
    number: string;
    minGrade?: string;
    canBeTakenConcurrently?: 'true';
    orEquivalent?: 'true';
}

interface RequirementCreditCount {
    type: 'creditCount';
    credits: number;
    department?: string | string[];
    level?: '1XX' | '2XX' | '3XX' | '4XX' | 'LD' | 'UD';
    minGrade?: string;
    canBeTakenConcurrently?: 'true';
}

interface RequirementCourseCount {
    type: 'courseCount';
    count: number;
    department?: string | string[];
    level?: '1XX' | '2XX' | '3XX' | '4XX' | 'LD' | 'UD';
    minGrade?: string;
    canBeTakenConcurrently?: 'true';
}

interface RequirementPermission {
    type: 'permission';
    note: string;
}

interface RequirementOther {
    type: 'other';
    note: string;
}




interface BlacklistedCourse {
    department: string;
    number: string;
    reason: string;
    timestamp: string; // ISO 8601 format
}

export type {CourseCondensedInfo, CreditConflict, SaveCourseRequirements as CourseRequirements, ParsedCourseRequirements, RequirementNode, RequirementGroup, RequirementProgram, RequirementCGPA, RequirementUDGPA, RequirementCourse, RequirementHSCourse, RequirementCreditCount, RequirementCourseCount, RequirementPermission, RequirementOther, BlacklistedCourse};

export interface ParseResult {
    success: boolean;
    data?: ParsedCourseRequirements;
    error?: string;
    confidence?: number;
    attempts: number;
    schemaValid: boolean;
    ambiguityCheckPassed: boolean;
}

export interface ProcessingStats {
    total: number;
    processed: number;
    skipped: number;
    successful: number;
    failed: number;
    errors: string[];
}

export interface CourseProcessingResult {
    course: CourseCondensedInfo;
    result: ParseResult;
    saved: boolean;
}

export interface AmbiguityCheckResult {
    passed: boolean;
    reason?: string;
    confidence?: number;
}

export interface RetryContext {
    attempt: number;
    maxAttempts: number;
    previousError?: string;
    schemaErrors?: string[];
    ambiguityIssues?: string;
}