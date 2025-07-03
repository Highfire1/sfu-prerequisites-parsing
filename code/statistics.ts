import * as fs from 'fs/promises';
import * as path from 'path';
import type { CourseCondensedInfo, CourseRequirements, BlacklistedCourse } from './types.js';

interface ParseStatistics {
    totalCourses: number;
    successfullyParsed: number;
    blacklisted: number;
    attempted: number;
    covered: number;
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
        console.log('🔍 Checking debug path:', debugPath);
        
        const files = await fs.readdir(debugPath);
        console.log('📁 Found files in llm_debug:', files.length);
        
        for (const file of files) {
            if (file.endsWith('_debug.json')) {
                // Extract course key from filename (e.g., "ACMA 231_debug.json" -> "ACMA-231")
                const courseKey = file.replace('_debug.json', '').replace(' ', '-');
                // console.log('📝 Adding course key:', courseKey);
                attemptedCourses.add(courseKey);
            }
        }
        
        console.log('✅ Total attempted courses found:', attemptedCourses.size);
    } catch (error) {
        console.log('❌ Error reading llm_debug directory:', error);
    }
    
    return attemptedCourses;
}

function createCourseKey(course: CourseCondensedInfo): string {
    return `${course.department}-${course.number}`;
}

function hasRequirements(course: CourseCondensedInfo): boolean {
    return !!(course.prerequisites?.trim() || course.corequisites?.trim() || course.notes?.trim());
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
    
    // Count each course's actual status
    let successfullyParsed = 0;
    let blacklisted = 0;
    let attempted = 0;
    let covered = 0;
    let notAttempted = 0;
    
    for (const course of coursesWithRequirements) {
        const courseKey = `${course.department}-${course.number}`;
        
        const isParsed = parsedCourseKeys.has(courseKey);
        const isBlacklisted = blacklistedCourseKeys.has(courseKey);
        const isAttempted = attemptedCourses.has(courseKey);
        
        if (isParsed) {
            successfullyParsed++;
        }
        
        if (isBlacklisted) {
            blacklisted++;
        }
        
        if (isAttempted) {
            attempted++;
        }
        
        if (isParsed || isBlacklisted || isAttempted) {
            covered++;
        } else {
            notAttempted++;
        }
    }
    
    const successPercentage = totalCourses > 0 ? (successfullyParsed / totalCourses) * 100 : 0;
    const coveragePercentage = totalCourses > 0 ? (covered / totalCourses) * 100 : 0;
    
    return {
        totalCourses,
        successfullyParsed,
        blacklisted,
        attempted,
        covered,
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
    console.log(`   Covered (attempted + blacklisted): ${stats.covered.toLocaleString()}`);
    console.log(`   Not yet attempted:                 ${stats.notAttempted.toLocaleString()}`);
    console.log();
    
    console.log('📊 PROGRESS METRICS:');
    console.log(`   Success rate:                      ${stats.successPercentage.toFixed(1)}%`);
    console.log(`   Coverage (attempted + blacklisted): ${stats.coveragePercentage.toFixed(1)}%`);
    console.log();
    
    // Progress bar for success rate
    const successBarLength = Math.max(0, Math.min(50, Math.round(stats.successPercentage / 2))); // Scale to 50 chars max, bound between 0-50
    const successBar = '█'.repeat(successBarLength) + '░'.repeat(50 - successBarLength);
    console.log(`   Success Progress:  [${successBar}] ${stats.successPercentage.toFixed(1)}%`);
    
    // Progress bar for coverage
    const coverageBarLength = Math.max(0, Math.min(50, Math.round(stats.coveragePercentage / 2))); // Scale to 50 chars max, bound between 0-50
    const coverageBar = '█'.repeat(coverageBarLength) + '░'.repeat(50 - coverageBarLength);
    console.log(`   Coverage Progress: [${coverageBar}] ${stats.coveragePercentage.toFixed(1)}%`);
    console.log();
    
    // Status breakdown
    console.log('🎯 STATUS BREAKDOWN:');
    console.log(`   ✅ Completed (parsed):             ${stats.successfullyParsed.toLocaleString()} (${((stats.successfullyParsed / stats.totalCourses) * 100).toFixed(1)}%)`);
    console.log(`   ⚫ Blacklisted (problematic):       ${stats.blacklisted.toLocaleString()} (${((stats.blacklisted / stats.totalCourses) * 100).toFixed(1)}%)`);
    console.log(`   🔄 Remaining to process:            ${stats.notAttempted.toLocaleString()} (${((stats.notAttempted / stats.totalCourses) * 100).toFixed(1)}%)`);
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