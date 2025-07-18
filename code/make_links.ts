import { promises as fs } from 'fs';
import path from 'path';
import type { CourseRequirements, RequirementNode } from './types.js';

/**
 * Link Value Logic:
 * - ALL_OF: Each child gets the full value (default: 1)
 * - ONE_OF: Value is split among children (value / number_of_children)
 * - TWO_OF: Value is doubled then split among children ((value * 2) / number_of_children)
 * 
 * This reflects the "strength" of each requirement:
 * - ALL_OF requirements are mandatory, so each has full weight
 * - ONE_OF requirements are alternatives, so weight is distributed
 * - TWO_OF requirements need multiple choices, so they're weighted higher but still distributed
 */

interface Node {
    id: string;
    title: string;
    group: string;
    size: number;
    depth: number; // Number of prerequisite levels needed to reach this course
}

interface Link {
    source: string;
    target: string;
    value: number;
}

// Extract course requirements from a RequirementNode recursively with link values
function extractCourseRequirementsWithValues(node: RequirementNode, baseValue: number = 1): Array<{ course: string, value: number }> {
    const courses: Array<{ course: string, value: number }> = [];

    switch (node.type) {
        case 'course':
            courses.push({
                course: `${node.department} ${node.number}`,
                value: baseValue
            });
            break;

        case 'HSCourse':
            // Treat high school courses as nodes too
            courses.push({
                course: `HS ${node.course}`,
                value: baseValue
            });
            break;

        case 'group':
            let childValue = baseValue;

            if (node.logic === 'ONE_OF') {
                // Split the value by the number of children in ONE_OF
                childValue = baseValue / node.children.length;
            } else if (node.logic === 'TWO_OF') {
                // Double the value but split by children for TWO_OF
                childValue = (baseValue * 2) / node.children.length;
            }
            // For ALL_OF, keep the same value

            // Recursively extract from all children with the calculated value
            for (const child of node.children) {
                courses.push(...extractCourseRequirementsWithValues(child, childValue));
            }
            break;

        // Ignore other types (creditCount, courseCount, CGPA, etc.)
        default:
            break;
    }

    return courses;
}

// Calculate the prerequisite depth for a course
function calculatePrerequisiteDepth(node: RequirementNode, courseDepths: Map<string, number>): number {
    switch (node.type) {
        case 'course':
            const courseId = `${node.department} ${node.number}`;
            // Return the depth of this course (0 if no prerequisites, or calculated depth + 1)
            return (courseDepths.get(courseId) || 0) + 1;

        case 'HSCourse':
            // High school courses have no prerequisites
            return 1;

        case 'group':
            if (node.children.length === 0) return 0;

            const childDepths = node.children.map(child =>
                calculatePrerequisiteDepth(child, courseDepths)
            ).filter(depth => depth > 0); // Filter out courses with no prerequisites

            if (childDepths.length === 0) return 0;

            if (node.logic === 'ONE_OF') {
                // For ONE_OF, take the minimum depth (easiest path)
                return Math.min(...childDepths);
            } else if (node.logic === 'TWO_OF') {
                // For TWO_OF, take the second minimum depth (need two courses)
                const sorted = childDepths.sort((a, b) => a - b);
                return sorted.length >= 2 ? sorted[1]! : sorted[0]!;
            } else {
                // For ALL_OF, take the maximum depth (need all courses)
                return Math.max(...childDepths);
            }

        // Ignore other types (creditCount, courseCount, CGPA, etc.)
        default:
            return 0;
    }
}

// Generate nodes and links from parsed requirements
function generateNodesAndLinks(requirements: CourseRequirements[]): { nodes: Node[], links: Link[] } {
    const nodesMap = new Map<string, Node>();
    const linkMap = new Map<string, Link>(); // Use map to consolidate duplicate links

    // Create a lookup map for course titles
    const titleMap = new Map<string, string>();
    requirements.forEach(course => {
        const courseId = `${course.department} ${course.number}`;
        titleMap.set(courseId, course.original_title);
    });

    // First pass: Calculate prerequisite depths
    const courseDepths = new Map<string, number>();

    // Initialize all courses with depth 0 (no prerequisites known yet)
    requirements.forEach(course => {
        const courseId = `${course.department} ${course.number}`;
        courseDepths.set(courseId, 0);
    });

    // Calculate depths based on prerequisites
    requirements.forEach(course => {
        const courseId = `${course.department} ${course.number}`;
        let maxDepth = 0;

        if (course.prerequisite) {
            maxDepth = Math.max(maxDepth, calculatePrerequisiteDepth(course.prerequisite, courseDepths));
        }

        if (course.corequisite) {
            maxDepth = Math.max(maxDepth, calculatePrerequisiteDepth(course.corequisite, courseDepths));
        }

        courseDepths.set(courseId, maxDepth);
    });

    // Second pass: Generate nodes and links
    for (const course of requirements) {
        const targetId = `${course.department} ${course.number}`;
        const depth = courseDepths.get(targetId) || 0;

        // Add the target course as a node with original_title and depth
        if (!nodesMap.has(targetId)) {
            nodesMap.set(targetId, {
                id: targetId,
                title: course.original_title,
                group: course.department,
                size: 1,
                depth: depth
            });
        }

        // Extract prerequisite courses with values
        if (course.prerequisite) {
            const prerequisiteCourses = extractCourseRequirementsWithValues(course.prerequisite);

            for (const { course: prereqId, value } of prerequisiteCourses) {
                // Add prerequisite as a node
                if (!nodesMap.has(prereqId)) {
                    // Extract department from course ID
                    const department = prereqId.split(' ')[0] || 'UNKNOWN';
                    const prereqDepth = courseDepths.get(prereqId) || 0;
                    nodesMap.set(prereqId, {
                        id: prereqId,
                        title: titleMap.get(prereqId) || prereqId,
                        group: department,
                        size: 1,
                        depth: prereqDepth
                    });
                }

                // Create unique key for this link
                const linkKey = `${prereqId}->${targetId}`;
                const roundedValue = Math.round(value * 100) / 100;

                // Keep only the link with the highest value if duplicate exists
                if (!linkMap.has(linkKey) || linkMap.get(linkKey)!.value < roundedValue) {
                    linkMap.set(linkKey, {
                        source: prereqId,
                        target: targetId,
                        value: roundedValue
                    });
                }
            }
        }

        // Extract corequisite courses with values
        if (course.corequisite) {
            const corequisiteCourses = extractCourseRequirementsWithValues(course.corequisite);

            for (const { course: coreqId, value } of corequisiteCourses) {
                // Add corequisite as a node
                if (!nodesMap.has(coreqId)) {
                    // Extract department from course ID
                    const department = coreqId.split(' ')[0] || 'UNKNOWN';
                    const coreqDepth = courseDepths.get(coreqId) || 0;
                    nodesMap.set(coreqId, {
                        id: coreqId,
                        title: titleMap.get(coreqId) || coreqId,
                        group: department,
                        size: 1,
                        depth: coreqDepth
                    });
                }

                // Create unique key for this link
                const linkKey = `${coreqId}->${targetId}`;
                const roundedValue = Math.round(value * 100) / 100;

                // Keep only the link with the highest value if duplicate exists
                if (!linkMap.has(linkKey) || linkMap.get(linkKey)!.value < roundedValue) {
                    linkMap.set(linkKey, {
                        source: coreqId,
                        target: targetId,
                        value: roundedValue
                    });
                }
            }
        }
    }

    // if you don't want to prune nodes with no links, set this to false
    if (false) {
        return {
            nodes: Array.from(nodesMap.values()),
            links: Array.from(linkMap.values())
        }
    }

    // Prune nodes that have no links (neither incoming nor outgoing)
    const linkedNodeIds = new Set<string>();
    const linkArray = Array.from(linkMap.values());

    // Collect all node IDs that have links
    linkArray.forEach(link => {
        linkedNodeIds.add(link.source);
        linkedNodeIds.add(link.target);
    });

    // Filter nodes to keep only those with links
    const prunedNodes = Array.from(nodesMap.values()).filter(node =>
        linkedNodeIds.has(node.id)
    );

    // Calculate node sizes based on outgoing link counts (how many courses each is a prerequisite to)
    const outgoingLinkCounts = new Map<string, number>();
    linkArray.forEach(link => {
        outgoingLinkCounts.set(link.source, (outgoingLinkCounts.get(link.source) || 0) + 1);
    });

    // Find the maximum outgoing link count for scaling
    const maxOutgoingLinks = Math.max(...Array.from(outgoingLinkCounts.values()), 1);

    // Update node sizes based on outgoing link count (scale from 1.00 to 3.00, rounded up to nearest 0.20)
    prunedNodes.forEach(node => {
        const linkCount = outgoingLinkCounts.get(node.id) || 0;
        if (linkCount === 0) {
            // Nodes with no outgoing links (leaf nodes) get size 1.00
            node.size = 1.00;
        } else {
            // Scale from 1.00 to 3.00 based on link count
            // Use logarithmic scaling for better distribution
            const scaledSize = 1 + (2 * Math.log(linkCount + 1) / Math.log(maxOutgoingLinks + 1));
            const clampedSize = Math.max(1, Math.min(3, scaledSize));
            
            // Round up to nearest 0.20 increment
            const roundedUp = Math.ceil(clampedSize / 0.20) * 0.20;
            node.size = Math.round(roundedUp * 100) / 100; // Ensure exactly 2 decimal places
        }
    });

    return {
        nodes: prunedNodes,
        links: linkArray
    };
}

// Convert array of objects to CSV string
function arrayToCSV<T>(data: T[]): string {
    if (data.length === 0) return '';

    // Get headers from the first object
    const headers = Object.keys(data[0] as any);
    const csvRows: string[] = [];

    // Add header row
    csvRows.push(headers.join(','));

    // Add data rows
    for (const row of data) {
        const values = headers.map(header => {
            const value = (row as any)[header];
            // Escape values that contain commas or quotes
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

async function main() {
    try {
        const INPUT_PATH = path.join(__dirname, 'generated_data', 'parsed_requirements.json');
        const NODES_OUTPUT_PATH = path.join(__dirname, 'generated_data', 'nodes.csv');
        const LINKS_OUTPUT_PATH = path.join(__dirname, 'generated_data', 'links.csv');

        console.log('Loading parsed requirements...');

        // Load the parsed requirements
        const requirementsContent = await fs.readFile(INPUT_PATH, 'utf-8');
        const requirements: CourseRequirements[] = JSON.parse(requirementsContent);

        console.log(`Loaded ${requirements.length} course requirements`);

        // Generate nodes and links
        console.log('Generating nodes and links...');
        const { nodes, links } = generateNodesAndLinks(requirements);

        console.log(`Generated ${nodes.length} nodes and ${links.length} links`);

        // Convert to CSV
        const nodesCSV = arrayToCSV(nodes);
        const linksCSV = arrayToCSV(links);

        // Write CSV files
        await fs.writeFile(NODES_OUTPUT_PATH, nodesCSV, 'utf-8');
        await fs.writeFile(LINKS_OUTPUT_PATH, linksCSV, 'utf-8');

        console.log(`✅ Nodes saved to: ${NODES_OUTPUT_PATH}`);
        console.log(`✅ Links saved to: ${LINKS_OUTPUT_PATH}`);

        // Print some statistics
        const departmentCounts = new Map<string, number>();
        nodes.forEach(node => {
            departmentCounts.set(node.group, (departmentCounts.get(node.group) || 0) + 1);
        });

        console.log('\n📊 Node Statistics by Department:');
        const sortedDepts = Array.from(departmentCounts.entries()).sort((a, b) => b[1] - a[1]);
        sortedDepts.slice(0, 10).forEach(([dept, count]) => {
            console.log(`   ${dept}: ${count} courses`);
        });

        if (sortedDepts.length > 10) {
            console.log(`   ... and ${sortedDepts.length - 10} more departments`);
        }

        // Count outgoing links for each node (how many courses each course is a prerequisite for)
        const outgoingLinkCounts = new Map<string, number>();
        links.forEach(link => {
            outgoingLinkCounts.set(link.source, (outgoingLinkCounts.get(link.source) || 0) + 1);
        });

        console.log('\n📈 Top 10 Courses (Prerequisite to x courses):');
        const sortedByLinks = Array.from(outgoingLinkCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        sortedByLinks.forEach(([courseId, linkCount], index) => {
            const node = nodes.find(n => n.id === courseId);
            const title = node ? node.title : courseId;
            console.log(`   ${index + 1}. ${courseId} (${linkCount} courses) - ${title}`);
        });

        // Show depth distribution
        const depthCounts = new Map<number, number>();
        nodes.forEach(node => {
            depthCounts.set(node.depth, (depthCounts.get(node.depth) || 0) + 1);
        });

        console.log('\n📊 Prerequisite Depth Distribution:');
        const sortedDepths = Array.from(depthCounts.entries()).sort((a, b) => a[0] - b[0]);
        sortedDepths.forEach(([depth, count]) => {
            console.log(`   Depth ${depth}: ${count} courses`);
        });

        // Show some examples of deep courses
        const deepCourses = nodes
            .filter(node => node.depth > 0)
            .sort((a, b) => b.depth - a.depth)
            .slice(0, 5);

        if (deepCourses.length > 0) {
            console.log('\n🏔️  Top 5 Deepest Courses:');
            deepCourses.forEach((node, index) => {
                console.log(`   ${index + 1}. ${node.id} (depth ${node.depth}) - ${node.title}`);
            });
        }

    } catch (error) {
        console.error('Error generating links:', error);
        process.exit(1);
    }
}

// Export for potential use in other modules
export { generateNodesAndLinks, extractCourseRequirementsWithValues };

// Run if this file is executed directly
if (import.meta.main) {
    main().catch(console.error);
}
