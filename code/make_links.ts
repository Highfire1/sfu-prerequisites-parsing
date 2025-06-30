import { promises as fs } from 'fs';
import path from 'path';
import type { CourseRequirements, RequirementNode } from './types.js';

interface Node {
    id: string;
    title: string;
    group: string;
    size: number;
}

interface Link {
    source: string;
    target: string;
    value: number;
}

// Extract course requirements from a RequirementNode recursively
function extractCourseRequirements(node: RequirementNode): string[] {
    const courses: string[] = [];
    
    switch (node.type) {
        case 'course':
            courses.push(`${node.department} ${node.number}`);
            break;
            
        case 'HSCourse':
            // Treat high school courses as nodes too
            courses.push(`HS ${node.course}`);
            break;
            
        case 'group':
            // Recursively extract from all children
            for (const child of node.children) {
                courses.push(...extractCourseRequirements(child));
            }
            break;
            
        // Ignore other types (creditCount, courseCount, CGPA, etc.)
        default:
            break;
    }
    
    return courses;
}

// Generate nodes and links from parsed requirements
function generateNodesAndLinks(requirements: CourseRequirements[]): { nodes: Node[], links: Link[] } {
    const nodesMap = new Map<string, Node>();
    const links: Link[] = [];
    
    for (const course of requirements) {
        const targetId = `${course.department} ${course.number}`;
        
        // Add the target course as a node
        if (!nodesMap.has(targetId)) {
            nodesMap.set(targetId, {
                id: targetId,
                title: targetId,
                group: course.department,
                size: 1
            });
        }
        
        // Extract prerequisite courses
        if (course.prerequisite) {
            const prerequisiteCourses = extractCourseRequirements(course.prerequisite);
            
            for (const prereqId of prerequisiteCourses) {
                // Add prerequisite as a node
                if (!nodesMap.has(prereqId)) {
                    // Extract department from course ID
                    const department = prereqId.split(' ')[0] || 'UNKNOWN';
                    nodesMap.set(prereqId, {
                        id: prereqId,
                        title: prereqId,
                        group: department,
                        size: 1
                    });
                }
                
                // Add link from prerequisite to target course
                links.push({
                    source: prereqId,
                    target: targetId,
                    value: 1
                });
            }
        }
        
        // Extract corequisite courses
        if (course.corequisite) {
            const corequisiteCourses = extractCourseRequirements(course.corequisite);
            
            for (const coreqId of corequisiteCourses) {
                // Add corequisite as a node
                if (!nodesMap.has(coreqId)) {
                    // Extract department from course ID
                    const department = coreqId.split(' ')[0] || 'UNKNOWN';
                    nodesMap.set(coreqId, {
                        id: coreqId,
                        title: coreqId,
                        group: department,
                        size: 1
                    });
                }
                
                // Add link from corequisite to target course
                links.push({
                    source: coreqId,
                    target: targetId,
                    value: 1
                });
            }
        }
    }
    
    return {
        nodes: Array.from(nodesMap.values()),
        links: links
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
        
    } catch (error) {
        console.error('Error generating links:', error);
        process.exit(1);
    }
}

// Export for potential use in other modules
export { generateNodesAndLinks, extractCourseRequirements };

// Run if this file is executed directly
if (import.meta.main) {
    main().catch(console.error);
}
