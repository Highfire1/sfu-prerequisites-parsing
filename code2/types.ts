const SCHEMA_VERSION = 'SFUv2';
// Requirements that you must satisfy in order to register for a course at SFU.

interface RequirementGroup {
    type: 'group';
    logic: 'ALL_OF' | 'ONE_OF' | 'TWO_OF';
    // n?: number; // only used if logic is 'N_OF'
    children: RequirementNode[];
}

// interface RequirementCourseGroup extends RequirementGroup {
//     children: RequirementTranscript[];
//     orEquivalent?: 'true';
//     canBeTakenConcurrently?: 'true';
// }


type RequirementNode = RequirementGroup | RequirementProgram | RequirementCGPA | RequirementUDGPA | RequirementTranscript | RequirementCreditCount | RequirementCourseCount |  RequirementPermission | RequirementOther | RequirementNote;

interface RequirementProgram {
    type: 'program';
    program: string;
}

// cumulative GPA
interface RequirementCGPA {
    type: 'CGPA';
    minCGPA: number;
}

// upper division GPA
interface RequirementUDGPA {
    type: 'UDGPA';
    minUDGPA: number;
}

// any item that shows up on your SFU transcript
interface RequirementTranscript {
    type: 'transcript';
    course: string; // e.g. "ACMA 231" or "French 12"
    department?: string; // only for sfu course
    minGrade?: string;
    orEquivalent?: 'true';
    canBeTakenConcurrently?: 'true';
}

interface RequirementCreditCount extends _RequirementTranscriptCollection {
    type: 'creditCount';
    creditCount: number;
}

interface RequirementCourseCount extends _RequirementTranscriptCollection {
    type: 'courseCount';
    courseCount: number;
}

// not for direct use
interface _RequirementTranscriptCollection {
    department?: string | string[];
    level?: levels | levels[];
    minGrade?: string;
    canBeTakenConcurrently?: 'true';
    designation?: 'Writing'
}
type levels = '1XX' | '2XX' | '3XX' | '4XX' | 'LD' | 'UD';


interface RequirementPermission {
    type: 'permission';
    text: string;
}

// for text that is a requirement but doesn't fit into any other category.
interface RequirementOther {
    type: 'other';
    text: string;
}

// for text that is not a requirement.
interface RequirementNote {
    type: 'note';
    text: string;
}