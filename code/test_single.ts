import { parseCourseRequirements } from './ask_llm.js';
import * as readline from 'readline';

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askUserChoice(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer.trim());
        });
    });
}

// Test with a single course
const testCourse = {
    department: "HSCI",
    number: "340", 
    title: "Social Determinants of Health",
    notes: "",
    prerequisites: "60 units and two HSCI 200-level courses with a minimum grade of C-, one of which may be taken concurrently.",
    corequisites: ""
};

function prettyPrintRequirement(node: any, indent = 0): string {
    const prefix = '  '.repeat(indent);
    
    if ('logic' in node) {
        const lines = [`${prefix}Group (${node.logic}):`];
        for (const child of node.children) {
            lines.push(prettyPrintRequirement(child, indent + 1));
        }
        return lines.join('\n');
    }
    
    switch (node.type) {
        case 'course':
            const gradeStr = node.minGrade ? ` (minimum "${node.minGrade}")` : '';
            const concurrentStr = node.canBeTakenConcurrently ? ' (can be taken concurrently)' : '';
            return `${prefix}${node.department} ${node.number}${gradeStr}${concurrentStr}`;
            
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
            return `${prefix}High School: ${node.course}${hsGradeStr}`;
            
        case 'program':
            return `${prefix}Program: ${node.program}`;
            
        case 'other':
            return `${prefix}Other: ${node.note}`;
            
        default:
            return `${prefix}Unknown requirement type`;
    }
}

async function testSingleCourse() {
    console.log('Testing single course parsing...\n');
    console.log(`Course: ${testCourse.department} ${testCourse.number} - ${testCourse.title}`);
    console.log(`Prerequisites: "${testCourse.prerequisites}"`);
    console.log(`Corequisites: "${testCourse.corequisites}"`);
    console.log('\nParsing...\n');

    const result = await parseCourseRequirements(testCourse);
    
    if ('error' in result) {
        console.log('❌ Error occurred:');
        console.log(`   Confidence: ${result.confidence}%`);
        console.log(`   Reason: ${result.reason}`);
    } else {
        console.log('✅ Successfully parsed!');
        console.log(`📋 Schema: ${result.rSchema}`);
        
        if (result.prerequisite) {
            console.log('\n📚 Prerequisites:');
            console.log(prettyPrintRequirement(result.prerequisite, 1));
        }
        
        if (result.corequisite) {
            console.log('\n🔗 Corequisites:');
            console.log(prettyPrintRequirement(result.corequisite, 1));
        }
        
        // Interactive prompt for user actions
        console.log('\nWhat would you like to do?');
        console.log('1) Print raw OpenRouter response');
        console.log('2) Save to database (pass for now)');
        console.log('3) Exit');
        
        const choice = await askUserChoice('Enter your choice (1/2/3): ');
        
        switch (choice.toLowerCase()) {
            case '1':
                console.log('\n📄 Raw OpenRouter Response:');
                console.log('─'.repeat(50));
                const rawResponse = (result as any).__rawResponse || 'Raw response not available';
                console.log(rawResponse);
                console.log('─'.repeat(50));
                break;
                
            case '2':
                console.log('💾 Save to database - passing for now...');
                break;
                
            case '3':
            default:
                console.log('👋 Exiting...');
                break;
        }
    }
    
    rl.close();
}

testSingleCourse().catch(console.error);
