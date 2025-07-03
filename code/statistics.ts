import * as fs from 'fs/promises';
import * as path from 'path';
import type { CourseCondensedInfo, CourseRequirements, BlacklistedCourse } from './types.js';

interface ParseStatistics {
    totalCourses: number;
    successfullyParsed: number;
    blacklisted: number;
    attempted: number;
    notAttempted: number;
    successPercentage: number;
    coveragePercentage: number;
}

async function loadVitalData(): Promise<CourseCondensedInfo[]> {
    try {
        const vitalDataPath = path.join(__dirname, 'source_data', 'vital_data.json');
        const content = await fs.readFile(vitalDataPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Error loading vital_data.json:', error);
        return [];
    }
}

async function loadSuccessfullyParsed(): Promise<CourseRequirements[]> {
    try {
        const parsedPath = path.join(__dirname, 'generated_data', 'parsed_requirements.json');
        const content = await fs.readFile(parsedPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.log('No parsed_requirements.json found or error reading it');
        return [];
    }
}

async function loadBlacklist(): Promise<BlacklistedCourse[]> {
    try {
        const blacklistPath = path.join(__dirname, 'generated_data', 'blacklisted.json');
        const content = await fs.readFile(blacklistPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.log('No blacklisted.json found or error reading it');
        return [];
    }
}

async function getAttemptedCourses(): Promise<Set<string>> {
    const attemptedCourses = new Set<string>();
    
    try {
        const debugPath = path.join(__dirname, 'generated_data', 'llm_debug');
        const files = await fs.readdir(debugPath);
        
        for (const file of files) {
            if (file.endsWith('.json')) {
                // Extract course key from filename (e.g., "ACMA-231.json" -> "ACMA-231")
                const courseKey = file.replace('.json', '');
                attemptedCourses.add(courseKey);
            }
        }
    } catch (error) {
        console.log('No llm_debug directory found or error reading it');
    }
    
    return attemptedCourses;
}

function createCourseKey(course: CourseCondensedInfo): string {
    return `${course.department}-${course.number}`;
}

function hasRequirements(course: CourseCondensedInfo): boolean {
    return !!(course.prerequisites?.trim() || course.corequisites?.trim());
}

async function generateStatistics(): Promise<ParseStatistics> {
    console.log('📊 Generating parsing statistics...\n');
    
    // Load all data sources
    const [vitalData, parsedCourses, blacklistedCourses, attemptedCourses] = await Promise.all([
        loadVitalData(),
        loadSuccessfullyParsed(),
        loadBlacklist(),
        getAttemptedCourses()
    ]);
    
    // Filter courses that actually have requirements
    const coursesWithRequirements = vitalData.filter(hasRequirements);
    const totalCourses = coursesWithRequirements.length;
    
    // Create sets for easy lookup
    const parsedCourseKeys = new Set(parsedCourses.map(course => `${course.department}-${course.number}`));
    const blacklistedCourseKeys = new Set(blacklistedCourses.map(course => `${course.department}-${course.number}`));
    
    // Count statistics
    const successfullyParsed = parsedCourses.length;
    const blacklisted = blacklistedCourses.length;
    const attempted = attemptedCourses.size;
    const notAttempted = totalCourses - attempted;
    
    const successPercentage = totalCourses > 0 ? (successfullyParsed / totalCourses) * 100 : 0;
    const coveragePercentage = totalCourses > 0 ? (attempted / totalCourses) * 100 : 0;
    
    return {
        totalCourses,
        successfullyParsed,
        blacklisted,
        attempted,
        notAttempted,
        successPercentage,
        coveragePercentage
    };
}

function printStatistics(stats: ParseStatistics): void {
    console.log('=' .repeat(60));
    console.log('📈 COURSE PARSING STATISTICS');
    console.log('='.repeat(60));
    console.log();
    
    console.log('📚 COURSE COUNTS:');
    console.log(`   Total courses (with requirements): ${stats.totalCourses.toLocaleString()}`);
    console.log(`   Successfully parsed:               ${stats.successfullyParsed.toLocaleString()}`);
    console.log(`   Blacklisted:                       ${stats.blacklisted.toLocaleString()}`);
    console.log(`   Attempted (has debug logs):        ${stats.attempted.toLocaleString()}`);
    console.log(`   Not yet attempted:                 ${stats.notAttempted.toLocaleString()}`);
    console.log();
    
    console.log('📊 PROGRESS METRICS:');
    console.log(`   Success rate:                      ${stats.successPercentage.toFixed(1)}%`);
    console.log(`   Coverage (attempted):              ${stats.coveragePercentage.toFixed(1)}%`);
    console.log();
    
    // Progress bar for success rate
    const successBarLength = Math.round(stats.successPercentage / 2); // Scale to 50 chars max
    const successBar = '█'.repeat(successBarLength) + '░'.repeat(50 - successBarLength);
    console.log(`   Success Progress:  [${successBar}] ${stats.successPercentage.toFixed(1)}%`);
    
    // Progress bar for coverage
    const coverageBarLength = Math.round(stats.coveragePercentage / 2); // Scale to 50 chars max
    const coverageBar = '█'.repeat(coverageBarLength) + '░'.repeat(50 - coverageBarLength);
    console.log(`   Coverage Progress: [${coverageBar}] ${stats.coveragePercentage.toFixed(1)}%`);
    console.log();
    
    // Status breakdown
    const remaining = stats.totalCourses - stats.successfullyParsed - stats.blacklisted;
    console.log('🎯 STATUS BREAKDOWN:');
    console.log(`   ✅ Completed (parsed):             ${stats.successfullyParsed.toLocaleString()} (${((stats.successfullyParsed / stats.totalCourses) * 100).toFixed(1)}%)`);
    console.log(`   ⚫ Blacklisted (problematic):       ${stats.blacklisted.toLocaleString()} (${((stats.blacklisted / stats.totalCourses) * 100).toFixed(1)}%)`);
    console.log(`   🔄 Remaining to process:            ${remaining.toLocaleString()} (${((remaining / stats.totalCourses) * 100).toFixed(1)}%)`);
    console.log();
    
    console.log('='.repeat(60));
}

async function main(): Promise<void> {
    try {
        const stats = await generateStatistics();
        printStatistics(stats);
        
        // thank you claude. these additional insights are very helpful. this is sarcastic if you couldn't tell.

        // Additional insights
        // if (stats.successPercentage < 50) {
        //     console.log('💡 INSIGHT: Less than 50% of courses successfully parsed. Consider reviewing common failure patterns.');
        // } else if (stats.successPercentage > 80) {
        //     console.log('🎉 EXCELLENT: Over 80% success rate! The parsing system is working well.');
        // } else {
        //     console.log('👍 GOOD: Solid progress on parsing. Continue processing remaining courses.');
        // }
        
        // if (stats.blacklisted > stats.successfullyParsed * 0.1) {
        //     console.log('⚠️  WARNING: High blacklist rate detected. Review blacklisted courses for patterns.');
        // }
        
        console.log();
        
    } catch (error) {
        console.error('Error generating statistics:', error);
        process.exit(1);
    }
}

// Run if this file is executed directly
if (import.meta.main) {
    main();
}

export { generateStatistics, printStatistics };