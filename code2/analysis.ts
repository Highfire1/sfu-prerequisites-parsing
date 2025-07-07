import { promises as fs } from 'fs';
import path from 'path';

interface Course {
    department: string;
    number: string;
    title: string;
    prerequisites?: string;
    corequisites?: string;
    [key: string]: any;
}

async function extractPrerequisites() {
    try {
        console.log('📖 Reading course outlines...');
        
        // Read the outlines.json file
        const outlinesPath = path.join(__dirname, 'data', 'outlines.json');
        const content = await fs.readFile(outlinesPath, 'utf-8');
        const courses: Course[] = JSON.parse(content);
        
        console.log(`📚 Found ${courses.length} courses`);
        
        // Extract prerequisites and corequisites
        const allRequirements: string[] = [];
        let prereqCount = 0;
        let coreqCount = 0;
        
        for (const course of courses) {
            const courseId = `${course.department} ${course.number}`;
            const courseTitle = course.title || 'No Title';
            
            // Add prerequisites if they exist
            if (course.prerequisites && course.prerequisites.trim()) {
                const prereqText = course.prerequisites.trim();
                allRequirements.push(prereqText);
                prereqCount++;
            }
            
            // Add corequisites if they exist
            if (course.corequisites && course.corequisites.trim()) {
                const coreqText = course.corequisites.trim();
                allRequirements.push(coreqText);
                coreqCount++;
            }
        }
        
        // Remove duplicates and get unique requirements
        const uniqueRequirements = [...new Set(allRequirements)];
        const duplicateCount = allRequirements.length - uniqueRequirements.length;
        
        // Write to text file
        const outputPath = path.join(__dirname, 'data', 'prerequisites_and_corequisites.txt');
        const outputText = uniqueRequirements.join('\n');
        await fs.writeFile(outputPath, outputText, 'utf-8');
        
        console.log(`✅ Successfully extracted requirements to ${outputPath}`);
        console.log(`📊 Statistics:`);
        console.log(`   Total courses: ${courses.length}`);
        console.log(`   Courses with prerequisites: ${prereqCount}`);
        console.log(`   Courses with corequisites: ${coreqCount}`);
        console.log(`   Total requirement instances: ${allRequirements.length}`);
        console.log(`   Unique requirement strings: ${uniqueRequirements.length}`);
        console.log(`   Duplicates found: ${duplicateCount}`);
        
    } catch (error) {
        console.error('❌ Error extracting prerequisites:', error);
        process.exit(1);
    }
}

// Run the extraction
extractPrerequisites();