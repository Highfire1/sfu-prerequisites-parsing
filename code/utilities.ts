import type { RequirementNode, RequirementGroup, RequirementCourseCount } from "./types";


function prettyPrintRequirement(node: RequirementNode, indent = 0): string {
    const prefix = '  '.repeat(indent);

    switch (node.type) {
        case 'group':
            // This is a RequirementGroup
            const lines = [`${prefix}Group (${node.logic}):`];
            for (const child of node.children) {
                lines.push(prettyPrintRequirement(child, indent + 1));
            }
            return lines.join('\n');

        case 'course':
            const gradeStr = node.minGrade ? ` (minimum "${node.minGrade}")` : '';
            const concurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            const equivalentStr = node.orEquivalent ? ' (or equivalent)' : '';
            return `${prefix}${node.department} ${node.number}${gradeStr}${concurrentStr}${equivalentStr}`;

        case 'creditCount':
            const deptStr = Array.isArray(node.department)
                ? node.department.join(', ')
                : node.department || '';
            const levelStr = node.level ? ` level ${node.level}` : '';
            const creditConcurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            if (!deptStr && !levelStr) {
                return `${prefix}${node.credits} units${creditConcurrentStr}.`;
            }
            if (!deptStr) {
                return `${prefix}${node.credits} units${levelStr}${creditConcurrentStr}.`;
            }
            if (!levelStr) {
                return `${prefix}${node.credits} units in ${deptStr}${creditConcurrentStr}.`;
            }
            return `${prefix}${node.credits} units in ${deptStr}${levelStr}${creditConcurrentStr}.`;

        case 'courseCount':
            const courseDeptStr = Array.isArray(node.department)
                ? node.department.join(', ')
                : node.department || 'any department';
            const courseLevelStr = node.level ? ` level ${node.level}` : '';
            const courseGradeStr = node.minGrade ? ` (minimum "${node.minGrade}")` : '';
            const courseConcurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            const courseWord = node.count === 1 ? 'course' : 'courses';
            return `${prefix}${node.count} ${courseWord} from ${courseDeptStr}${courseLevelStr}${courseGradeStr}${courseConcurrentStr}`;

        case 'CGPA':
            return `${prefix}CGPA of ${node.minCGPA}`;

        case 'UDGPA':
            return `${prefix}Upper Division GPA of ${node.minUDGPA}`;

        case 'HSCourse':
            const hsGradeStr = node.minGrade ? ` (minimum "${node.minGrade}")` : '';
            const hsEquivalentStr = node.orEquivalent ? ' (or equivalent)' : '';
            return `${prefix}High School: ${node.course}${hsGradeStr}${hsEquivalentStr}`;

        case 'program':
            return `${prefix}Program: ${node.program}`;

        case 'permission':
            return `${prefix}Permission: ${node.note}`;

        case 'other':
            return `${prefix}Other: ${node.note}`;

        default:
            return `${prefix}Unknown requirement type`;
    }
}

// Helper functions for formatting
function formatDepartments(departments: string | string[] | undefined, fallback: string): string {
    if (!departments) return fallback;
    return Array.isArray(departments) ? departments.join(', ') : departments;
}

function formatLevel(level: string | undefined): string {
    if (!level) return '';
    
    const levelLower = level.toLowerCase();
    switch (levelLower) {
        case 'ld': return 'lower division';
        case 'ud': return 'upper division';
        default: return `level ${level}`;
    }
}

function formatGrade(minGrade: string | undefined): string {
    return minGrade ? ` with a minimum grade of "${minGrade}"` : '';
}

function formatConcurrent(canBeTakenConcurrently: 'true' | undefined): string {
    return canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
}

function formatEquivalent(orEquivalent: 'true' | undefined): string {
    return orEquivalent ? ' or equivalent' : '';
}

function ensurePeriod(str: string): string {
    return str.endsWith('.') ? str : str + '.';
}

function removePeriod(str: string): string {
    return str.replace(/\.$/, '');
}

// Check if a node contains courses (for special case detection)
function containsCourses(node: RequirementNode): boolean {
    if (node.type === 'course' || node.type === 'creditCount') return true;
    if (node.type === 'group') return node.children.some(child => containsCourses(child));
    return false;
}

// Handle special case: creditCount + course/group pattern
function handleCreditCountWithCourses(creditNode: RequirementNode, courseNode: RequirementNode, indent: number): string | null {
    if (creditNode.type !== 'creditCount') return null;
    
    const isValidSecondNode = courseNode.type === 'creditCount' || 
                             courseNode.type === 'course' || 
                             (courseNode.type === 'group' && containsCourses(courseNode));
    
    if (!isValidSecondNode) return null;
    
    const creditStr = readablePrintRequirement(creditNode, indent);
    const courseStr = removePeriod(readablePrintRequirement(courseNode, indent));
    return `At least ${creditStr}, including ${courseStr}.`;
}

// Handle group logic formatting
function formatGroup(node: RequirementGroup, indent: number): string {
    const childrenStrings = node.children.map((child: RequirementNode) => readablePrintRequirement(child, indent));
    
    switch (node.logic) {
        case 'ALL_OF':
            return childrenStrings.map(ensurePeriod).join(' ');
        case 'ONE_OF':
            return childrenStrings.join(' or ');
        case 'TWO_OF':
            return `any two of: ${childrenStrings.join(', ')}`;
        default:
            return '';
    }
}

// Handle courseCount formatting
function formatCourseCount(node: RequirementCourseCount): string {
    const deptStr = formatDepartments(node.department, 'any department');
    const levelWord = formatLevel(node.level);
    const gradeStr = formatGrade(node.minGrade);
    const concurrentStr = formatConcurrent(node.canBeTakenConcurrently);
    const courseWord = node.count === 1 ? 'course' : 'courses';

    // Special case: single course with specific department and level
    if (node.count === 1 && typeof node.department === 'string' && node.level) {
        return `any ${levelWord} ${node.department} course${gradeStr}${concurrentStr}`;
    }

    // General case
    let result = `${node.count} ${courseWord}`;
    if (levelWord) {
        result += ` (${levelWord})`;
    }
    result += ` from ${deptStr}${gradeStr}${concurrentStr}`;
    return result;
}

// Main function: convert node to human-readable string
function readablePrintRequirement(node: RequirementNode, indent = 0): string {
    // Special case: ALL_OF group with creditCount + courses pattern
    if (node.type === 'group' && 
        node.logic === 'ALL_OF' && 
        node.children.length === 2 && 
        node.children[0]?.type === 'creditCount') {
        
        const specialCase = handleCreditCountWithCourses(node.children[0], node.children[1]!, indent);
        if (specialCase) return specialCase;
    }

    switch (node.type) {
        case 'group':
            return formatGroup(node, indent);
            
        case 'course':
            const courseGradeStr = formatGrade(node.minGrade);
            const courseConcurrentStr = formatConcurrent(node.canBeTakenConcurrently);
            const equivalentStr = formatEquivalent(node.orEquivalent);
            return `${node.department} ${node.number}${courseGradeStr}${courseConcurrentStr}${equivalentStr}`;
            
        case 'creditCount':
            const deptStr = formatDepartments(node.department, 'any course');
            const levelStr = node.level ? ` at level ${node.level}` : '';
            const creditConcurrentStr = formatConcurrent(node.canBeTakenConcurrently);
            return `${node.credits} units${deptStr !== 'any course' ? ' of ' + deptStr : ''}${levelStr}${creditConcurrentStr}`;
            
        case 'courseCount':
            return formatCourseCount(node);
            
        case 'CGPA':
            return `a CGPA of at least ${node.minCGPA}`;
            
        case 'UDGPA':
            return `an Upper Division GPA of at least ${node.minUDGPA}`;
            
        case 'HSCourse':
            const hsGradeStr = formatGrade(node.minGrade);
            const hsEquivalentStr = formatEquivalent(node.orEquivalent);
            return `High School: ${node.course}${hsGradeStr}${hsEquivalentStr}`;
            
        case 'program':
            return `Program: ${node.program}`;
            
        case 'permission':
            return `Permission: ${node.note}`;
            
        case 'other':
            return `Other: ${node.note}`;
            
        default:
            return `Unknown requirement type`;
    }
}

export { prettyPrintRequirement, readablePrintRequirement }