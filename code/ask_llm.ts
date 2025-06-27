import OpenAI from 'openai';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import * as readline from 'readline';

import type { CourseRequirements, RequirementNode, CourseCondensedInfo } from './types.js';

// Load environment variables
config();


interface LLMError {
    error: true;
    reason: string;
    confidence: number;
}

type LLMResponse = CourseRequirements | LLMError;

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

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

const typesPath = path.join(__dirname, 'types.ts');
const types = await fs.readFile(typesPath, 'utf-8');

const systemPrompt = `You are an expert at parsing university course prerequisites and corequisites from natural language text into structured data.

Your task is to parse the prerequisites and corequisites for a course into a specific JSON schema. 

SCHEMA DEFINITIONS:
- CourseRequirements: Main output structure
- RequirementNode: Can be a group (AND/OR logic) or specific requirement types
- Types: 'group', 'course', 'creditCount', 'courseCount', 'CGPA', 'UDGPA', 'HSCourse', 'program', 'permission', 'other'

PARSING RULES:
1. Course numbers like "HSCI 200-level" means level: '2'
2. "Upper division" = level: 'UD', "Lower division" = level: 'LD'
3. "60 units" or "60 credits" = creditCount with credits: 60
4. "Two courses" = courseCount with count: 2
5. "may be taken concurrently" = canBeTakenConcurrently: 'true'
6. "or equivalent" = orEquivalent: 'true'
7. Extract minimum grades like "C-", "B+", etc.
8. Parse CGPA requirements like "CGPA of 2.50"
9. Parse program requirements like "Faculty of Science"
10. For permission requirements (e.g., "Students must apply and receive permission from the co-op coordinator", "Approval of Senior Supervisor is needed"), use:
    {
      "type": "permission",
      "note": "Permission from the co-op coordinator is required"
    }
11. You should only return actual prerequisites or corequisites, not general course information or other notes.

CONFIDENCE REQUIREMENTS:
- Only return a parsed result if you are highly confident (>85%) in your parsing
- If confidence is low, return an error with specific reasons
- Common reasons for low confidence:
  - Ambiguous wording
  - Complex nested logic that's unclear
  - Unusual abbreviations or terminology
  - Missing context for proper interpretation

OUTPUT FORMAT:
Return ONLY valid JSON - either a CourseRequirements object or an error object:

{
  "error": true,
  "reason": "Specific reason for low confidence",
  "confidence": 45
}


Some example outputs:

"MATH 150, 151, 154 or 157."
{
    "department": "MATH",
    "number": "",
    "rSchema": "SFUv0.10",
    "prerequisite": {
        "type": "group",
        "logic": "OR",
        "children": [
            { "type": "course", "department": "MATH", "number": "150" },
            { "type": "course", "department": "MATH", "number": "151" },
            { "type": "course", "department": "MATH", "number": "154" },
            { "type": "course", "department": "MATH", "number": "157" }
        ]
    }
}

"CMPT 383 with a minimum grade of C-."
{
    "department": "CMPT",
    "number": "383",
    "rSchema": "SFUv0.10",
    "prerequisite": {
        "type": "course",
        "department": "CMPT",
        "number": "383",
        "minGrade": "C-"
    }
}

Type definitions follow:
${types}
`;


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

async function parseCourseRequirements(course: CourseCondensedInfo): Promise<LLMResponse> {
    // Store the raw response for potential display
    let rawResponseContent = '';

    const userPrompt = `Parse the prerequisites and corequisites for this course:

    Department: ${course.dept}
    Number: ${course.number}
    Title: ${course.title}
    Prerequisites: "${course.prerequisites}"
    Corequisites: "${course.corequisites}"
    Notes: "${course.notes}"

    Return the parsed CourseRequirements JSON or an error if not confident enough.`;

    try {
        const response = await client.chat.completions.create({
            model: 'google/gemini-2.5-pro',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            // max_tokens: 2000,
        });

        const content = response.choices[0]?.message?.content;
        rawResponseContent = content || 'No response received';
        
        if (!content) {
            return {
                error: true,
                reason: 'No response from LLM',
                confidence: 0
            };
        }

        // Parse the JSON response
        try {
            // Remove markdown code blocks if present
            let cleanContent = content.trim();
            if (cleanContent.startsWith('```json')) {
                cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            const parsed = JSON.parse(cleanContent) as LLMResponse;
            // Store raw response for later use
            (parsed as any).__rawResponse = rawResponseContent;
            return parsed;
        } catch (parseError) {
            return {
                error: true,
                reason: `Failed to parse LLM response as JSON: ${parseError} - Response: ${content}`,
                confidence: 0
            };
        }

    } catch (error) {
        return {
            error: true,
            reason: `API call failed: ${error}`,
            confidence: 0
        };
    }
}

async function getRawResponse(course: CourseCondensedInfo): Promise<string> {
    const userPrompt = `Parse the prerequisites and corequisites for this course:

Department: ${course.dept}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Return the parsed CourseRequirements JSON or an error if not confident enough.`;

    try {
        const response = await client.chat.completions.create({
            model: 'google/gemini-2.5-flash-lite-preview-06-17',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
        });

        return response.choices[0]?.message?.content || 'No response received';
    } catch (error) {
        return `Error getting raw response: ${error}`;
    }
}

async function processAllCourses() {
    const VITAL_DATA_PATH = path.join(__dirname, 'data', 'vital_data.json');
    const OUTPUT_PATH = path.join(__dirname, 'data', 'parsed_requirements.json');
    
    try {
        // Load the vital data
        const vitalDataContent = await fs.readFile(VITAL_DATA_PATH, 'utf-8');
        const courses: CourseCondensedInfo[] = JSON.parse(vitalDataContent);
        
        console.log(`Processing ${courses.length} courses...`);
        
        const results: Array<{
            original: CourseCondensedInfo;
            parsed: LLMResponse;
            timestamp: string;
        }> = [];
        
        // Process courses one by one
        for (let i = 0; i < courses.length; i++) {
            const course = courses[i];
            if (!course) continue; // Skip if undefined

            const prereqLength = course.prerequisites ? course.prerequisites.length : 0;
            const coreqLength = course.corequisites ? course.corequisites.length : 0;
            if ((prereqLength + coreqLength) < 500) {
                console.log('  → Skipping (combined prerequisites and corequisites are less than 300 characters)');
                continue;
            }
            
            console.log(`\n[${i + 1}/${courses.length}] Processing ${course.dept} ${course.number}: ${course.title}`);
            
            // Skip courses with no prerequisites or corequisites
            if (!course.prerequisites && !course.corequisites) {
                console.log('  → Skipping (no prerequisites or corequisites)');
                continue;
            }
            
            console.log(`  Prerequisites: "${course.prerequisites}"`);
            console.log(`  Corequisites: "${course.corequisites}"`);
            
            const parsed = await parseCourseRequirements(course);
            
            if ('error' in parsed) {
                console.log(`  ❌ Error (confidence: ${parsed.confidence}%): ${parsed.reason}`);
            } else {
                console.log(`  ✅ Successfully parsed`);
                console.log(`  📋 Schema: ${parsed.rSchema}`);
                if (parsed.prerequisite) {
                    console.log(`  📚 Prerequisites:`);
                    console.log(prettyPrintRequirement(parsed.prerequisite, 2));
                }
                if (parsed.corequisite) {
                    console.log(`  🔗 Corequisites:`);
                    console.log(prettyPrintRequirement(parsed.corequisite, 2));
                }
                if (parsed.recommended_prerequisite) {
                    console.log(`  📖 Recommended Prerequisites:`);
                    console.log(prettyPrintRequirement(parsed.recommended_prerequisite, 2));
                }
                if (parsed.recommended_corequisite) {
                    console.log(`  📖 Recommended Corequisites:`);
                    console.log(prettyPrintRequirement(parsed.recommended_corequisite, 2));
                }
            }
            
            // Interactive prompt for user actions
            console.log('\n  What would you like to do?');
            console.log('  1) Print raw OpenRouter response');
            console.log('  2) Save to database (pass for now)');
            console.log('  3) Skip/Continue');
            console.log('  q) Quit processing');
            
            const choice = await askUserChoice('  Enter your choice (1/2/3/q): ');
            
            switch (choice.toLowerCase()) {
                case '1':
                    console.log('\n  📄 Raw OpenRouter Response:');
                    console.log('  ' + '─'.repeat(50));
                    // Get the raw response - we need to modify parseCourseRequirements to return it
                    const rawResponse = await getRawResponse(course);
                    console.log(rawResponse);
                    console.log('  ' + '─'.repeat(50));
                    break;
                    
                case '2':
                    console.log('  💾 Save to database - passing for now...');
                    break;
                    
                case '3':
                    console.log('  ⏭️  Continuing...');
                    break;
                    
                case 'q':
                    console.log('  👋 Quitting...');
                    rl.close();
                    return;
                    
                default:
                    console.log('  ⚠️  Invalid choice, continuing...');
                    break;
            }
            
            results.push({
                original: course,
                parsed,
                timestamp: new Date().toISOString()
            });
            
            // Save intermediate results every 10 courses
            if (results.length % 10 === 0) {
                await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
                console.log(`  💾 Saved intermediate results (${results.length} processed)`);
            }
            
            // Add a small delay to be respectful to the API
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Save final results
        await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
        
        // Close readline interface
        rl.close();
        
        // Print summary
        const successful = results.filter(r => !('error' in r.parsed)).length;
        const errors = results.filter(r => 'error' in r.parsed).length;
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`   Total processed: ${results.length}`);
        console.log(`   Successful: ${successful}`);
        console.log(`   Errors: ${errors}`);
        console.log(`   Results saved to: ${OUTPUT_PATH}`);
        
    } catch (error) {
        console.error('Error processing courses:', error);
        rl.close();
        process.exit(1);
    }
}

// Main execution
async function main() {
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY not found in environment variables');
        console.error('Please add your OpenRouter API key to the .env file');
        process.exit(1);
    }
    
    await processAllCourses();
}

// Export for potential use in other modules
export { parseCourseRequirements, processAllCourses };

// Run if this file is executed directly
if (import.meta.main) {
    main().catch(console.error);
}
