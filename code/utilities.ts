import type { RequirementNode } from "./types";


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
                : node.department || 'any course';
            const levelStr = node.level ? ` level ${node.level}` : '';
            const creditConcurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            return `${prefix}${node.credits} credits of ${deptStr}${levelStr}${creditConcurrentStr}`;

        case 'courseCount':
            const courseDeptStr = Array.isArray(node.department)
                ? node.department.join(', ')
                : node.department || 'any department';
            const courseLevelStr = node.level ? ` level ${node.level}` : '';
            const courseGradeStr = node.minGrade ? ` (minimum "${node.minGrade}")` : '';
            const courseConcurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            return `${prefix}${node.count} courses from ${courseDeptStr}${courseLevelStr}${courseGradeStr}${courseConcurrentStr}`;

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


export { prettyPrintRequirement}