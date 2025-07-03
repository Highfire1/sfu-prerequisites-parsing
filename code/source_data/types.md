```js
const SCHEMA_VERSION = 'SFUv1.1';

// What you should return
interface ParsedCourseRequirements {
    department: string;
    number: string;
    schema_version: string;
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];
}

// for credit_conficts only
type CreditConflict = ConflictEquivalentCourse | ConflictOther;

interface ConflictEquivalentCourse {
    type: 'conflict_course';
    department: string;
    number: string;
    title?: string; // if specified
}

interface ConflictOther {
    type: 'conflict_other';
    note: string;
}


// for prerequisites and corequisites
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
```