```js
const SCHEMA_VERSION = 'SFUv1';


interface ConflictEquivalentCourse {
    type: 'conflict_course';
    subject: string;
    course: string;
    title?: string;
}

interface ConflictOther {
    type: 'conflict_other';
    note: string;
}

type CreditConflict = ConflictEquivalentCourse | ConflictOther;

interface ParsedCourseRequirements {
    department: string;
    number: string;
    r_schema: string;
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];
    rawResponse?: string;
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
    course_code: string;
    reason: string;
}
```