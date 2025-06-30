import type { RequirementNode, RequirementGroup, RequirementCourseCount, ParsedCourseRequirements, CreditConflict } from "./types";


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

// Schema validation result interface
interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

// Utility functions for validation
function isString(value: any): value is string {
    return typeof value === 'string';
}

function isNumber(value: any): value is number {
    return typeof value === 'number' && !isNaN(value);
}

function isObject(value: any): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isArray(value: any): value is any[] {
    return Array.isArray(value);
}

// Validate CreditConflict objects
function validateCreditConflict(conflict: any, path: string): string[] {
    const errors: string[] = [];
    
    if (!isObject(conflict)) {
        errors.push(`${path}: Must be an object`);
        return errors;
    }
    
    const conflictObj = conflict as Record<string, any>;
    
    if (!isString(conflictObj.type)) {
        errors.push(`${path}.type: Must be a string`);
    } else if (conflictObj.type !== 'conflict_course' && conflictObj.type !== 'conflict_other') {
        errors.push(`${path}.type: Must be either 'conflict_course' or 'conflict_other'`);
    }
    
    if (conflictObj.type === 'conflict_course') {
        if (!isString(conflictObj.subject)) {
            errors.push(`${path}.subject: Must be a string`);
        }
        if (!isString(conflictObj.course)) {
            errors.push(`${path}.course: Must be a string`);
        }
        if (conflictObj.title !== undefined && !isString(conflictObj.title)) {
            errors.push(`${path}.title: Must be a string if provided`);
        }
        // Check for invalid properties
        const validProps = ['type', 'subject', 'course', 'title'];
        Object.keys(conflictObj).forEach(key => {
            if (!validProps.includes(key)) {
                errors.push(`${path}.${key}: Invalid property for conflict_course type`);
            }
        });
    } else if (conflictObj.type === 'conflict_other') {
        if (!isString(conflictObj.note)) {
            errors.push(`${path}.note: Must be a string`);
        }
        // Check for invalid properties
        const validProps = ['type', 'note'];
        Object.keys(conflictObj).forEach(key => {
            if (!validProps.includes(key)) {
                errors.push(`${path}.${key}: Invalid property for conflict_other type`);
            }
        });
    }
    
    return errors;
}

// Validate RequirementNode recursively
function validateRequirementNode(node: any, path: string): string[] {
    const errors: string[] = [];
    
    if (!isObject(node)) {
        errors.push(`${path}: Must be an object`);
        return errors;
    }
    
    const nodeObj = node as Record<string, any>;
    
    if (!isString(nodeObj.type)) {
        errors.push(`${path}.type: Must be a string`);
        return errors;
    }
    
    switch (nodeObj.type) {
        case 'group':
            if (!isString(nodeObj.logic)) {
                errors.push(`${path}.logic: Must be a string`);
            } else if (!['ALL_OF', 'ONE_OF', 'TWO_OF'].includes(nodeObj.logic)) {
                errors.push(`${path}.logic: Must be 'ALL_OF', 'ONE_OF', or 'TWO_OF'`);
            }
            
            if (!isArray(nodeObj.children)) {
                errors.push(`${path}.children: Must be an array`);
            } else {
                nodeObj.children.forEach((child: any, index: number) => {
                    errors.push(...validateRequirementNode(child, `${path}.children[${index}]`));
                });
            }
            break;
            
        case 'course':
            if (!isString(nodeObj.department)) {
                errors.push(`${path}.department: Must be a string`);
            }
            if (!isString(nodeObj.number)) {
                errors.push(`${path}.number: Must be a string`);
            }
            if (nodeObj.minGrade !== undefined && !isString(nodeObj.minGrade)) {
                errors.push(`${path}.minGrade: Must be a string if provided`);
            }
            if (nodeObj.canBeTakenConcurrently !== undefined && nodeObj.canBeTakenConcurrently !== 'true') {
                errors.push(`${path}.canBeTakenConcurrently: Must be 'true' if provided`);
            }
            if (nodeObj.orEquivalent !== undefined && nodeObj.orEquivalent !== 'true') {
                errors.push(`${path}.orEquivalent: Must be 'true' if provided`);
            }
            break;
            
        case 'HSCourse':
            if (!isString(nodeObj.course)) {
                errors.push(`${path}.course: Must be a string`);
            }
            if (nodeObj.minGrade !== undefined && !isString(nodeObj.minGrade)) {
                errors.push(`${path}.minGrade: Must be a string if provided`);
            }
            if (nodeObj.orEquivalent !== undefined && nodeObj.orEquivalent !== 'true') {
                errors.push(`${path}.orEquivalent: Must be 'true' if provided`);
            }
            break;
            
        case 'creditCount':
            if (!isNumber(nodeObj.credits)) {
                errors.push(`${path}.credits: Must be a number`);
            }
            if (nodeObj.department !== undefined) {
                if (!isString(nodeObj.department) && !isArray(nodeObj.department)) {
                    errors.push(`${path}.department: Must be a string or array of strings if provided`);
                } else if (isArray(nodeObj.department)) {
                    nodeObj.department.forEach((dept: any, index: number) => {
                        if (!isString(dept)) {
                            errors.push(`${path}.department[${index}]: Must be a string`);
                        }
                    });
                }
            }
            if (nodeObj.level !== undefined) {
                if (!isString(nodeObj.level) || !['1XX', '2XX', '3XX', '4XX', 'LD', 'UD'].includes(nodeObj.level)) {
                    errors.push(`${path}.level: Must be '1XX', '2XX', '3XX', '4XX', 'LD', or 'UD' if provided`);
                }
            }
            if (nodeObj.canBeTakenConcurrently !== undefined && nodeObj.canBeTakenConcurrently !== 'true') {
                errors.push(`${path}.canBeTakenConcurrently: Must be 'true' if provided`);
            }
            break;
            
        case 'courseCount':
            if (!isNumber(nodeObj.count)) {
                errors.push(`${path}.count: Must be a number`);
            }
            if (nodeObj.department !== undefined) {
                if (!isString(nodeObj.department) && !isArray(nodeObj.department)) {
                    errors.push(`${path}.department: Must be a string or array of strings if provided`);
                } else if (isArray(nodeObj.department)) {
                    nodeObj.department.forEach((dept: any, index: number) => {
                        if (!isString(dept)) {
                            errors.push(`${path}.department[${index}]: Must be a string`);
                        }
                    });
                }
            }
            if (nodeObj.level !== undefined) {
                if (!isString(nodeObj.level) || !['1XX', '2XX', '3XX', '4XX', 'LD', 'UD'].includes(nodeObj.level)) {
                    errors.push(`${path}.level: Must be '1XX', '2XX', '3XX', '4XX', 'LD', or 'UD' if provided`);
                }
            }
            if (nodeObj.minGrade !== undefined && !isString(nodeObj.minGrade)) {
                errors.push(`${path}.minGrade: Must be a string if provided`);
            }
            if (nodeObj.canBeTakenConcurrently !== undefined && nodeObj.canBeTakenConcurrently !== 'true') {
                errors.push(`${path}.canBeTakenConcurrently: Must be 'true' if provided`);
            }
            break;
            
        case 'CGPA':
            if (!isNumber(nodeObj.minCGPA)) {
                errors.push(`${path}.minCGPA: Must be a number`);
            }
            break;
            
        case 'UDGPA':
            if (!isNumber(nodeObj.minUDGPA)) {
                errors.push(`${path}.minUDGPA: Must be a number`);
            }
            break;
            
        case 'program':
            if (!isString(nodeObj.program)) {
                errors.push(`${path}.program: Must be a string`);
            }
            break;
            
        case 'permission':
            if (!isString(nodeObj.note)) {
                errors.push(`${path}.note: Must be a string`);
            }
            break;
            
        case 'other':
            if (!isString(nodeObj.note)) {
                errors.push(`${path}.note: Must be a string`);
            }
            break;
            
        default:
            errors.push(`${path}.type: Invalid requirement type '${nodeObj.type}'`);
            break;
    }
    
    return errors;
}

// Main schema validation function for ParsedCourseRequirements
function validateParsedCourseRequirements(parsed: any): ValidationResult {
    const errors: string[] = [];
    
    // Check if input is an object
    if (!isObject(parsed)) {
        return {
            isValid: false,
            errors: ['Root: Must be an object']
        };
    }
    
    const parsedObj = parsed as Record<string, any>;
    
    // Validate required fields
    if (!isString(parsedObj.department)) {
        errors.push('department: Must be a string');
    }
    
    if (!isString(parsedObj.number)) {
        errors.push('number: Must be a string');
    }
    
    if (!isString(parsedObj.r_schema)) {
        errors.push('r_schema: Must be a string');
    }
    
    // Validate optional requirement fields
    const requirementFields = ['prerequisite', 'corequisite', 'recommended_prerequisite', 'recommended_corequisite'];
    requirementFields.forEach(field => {
        if (parsedObj[field] !== undefined) {
            errors.push(...validateRequirementNode(parsedObj[field], field));
        }
    });
    
    // Validate credit_conflicts if present
    if (parsedObj.credit_conflicts !== undefined) {
        if (!isArray(parsedObj.credit_conflicts)) {
            errors.push('credit_conflicts: Must be an array if provided');
        } else {
            parsedObj.credit_conflicts.forEach((conflict: any, index: number) => {
                errors.push(...validateCreditConflict(conflict, `credit_conflicts[${index}]`));
            });
        }
    }
    
    // Validate rawResponse if present (should be string)
    if (parsedObj.rawResponse !== undefined && !isString(parsedObj.rawResponse)) {
        errors.push('rawResponse: Must be a string if provided');
    }
    
    // Check for unexpected properties
    const validTopLevelProps = [
        'department', 'number', 'r_schema', 
        'prerequisite', 'corequisite', 'recommended_prerequisite', 'recommended_corequisite',
        'credit_conflicts', 'rawResponse'
    ];
    Object.keys(parsedObj).forEach(key => {
        if (!validTopLevelProps.includes(key)) {
            errors.push(`${key}: Unexpected property`);
        }
    });
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

export { prettyPrintRequirement, readablePrintRequirement, validateParsedCourseRequirements };
export type { ValidationResult };