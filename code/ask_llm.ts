import OpenAI from 'openai';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import * as readline from 'readline';

import type { CourseRequirements, RequirementNode, CourseCondensedInfo } from './types.js';
import { prettyPrintRequirement } from './utilities.js';

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
12. Do not add words that are not present in the original text.


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
You do not have to include spacing or formatting, just the JSON structure.

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



async function parseCourseRequirements(course: CourseCondensedInfo): Promise<LLMResponse> {
    // Store the raw response for potential display
    let rawResponseContent = '';

    const userPrompt = `Parse the prerequisites and corequisites for this course:

    Department: ${course.department}
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
            // Store raw response in the proper field if it's a successful parse
            if (!('error' in parsed)) {
                parsed.rawResponse = rawResponseContent;
            }
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

async function processAllCourses() {
    const VITAL_DATA_PATH = path.join(__dirname, 'data', 'vital_data.json');
    const OUTPUT_PATH = path.join(__dirname, 'data', 'parsed_requirements.json');
    
    try {
        // Load the vital data
        const vitalDataContent = await fs.readFile(VITAL_DATA_PATH, 'utf-8');
        const courses: CourseCondensedInfo[] = JSON.parse(vitalDataContent);
        
        console.log(`Processing ${courses.length} courses...`);
        
        // Load existing results if they exist
        let results: CourseRequirements[] = [];
        
        try {
            const existingContent = await fs.readFile(OUTPUT_PATH, 'utf-8');
            results = JSON.parse(existingContent);
            console.log(`Loaded ${results.length} existing results from ${OUTPUT_PATH}`);
        } catch (error) {
            console.log('No existing results found, starting fresh');
        }
        
        // Create a set of already processed courses for quick lookup
        const processedCourses = new Set(
            results.map(r => `${r.department}-${r.number}`)
        );
        
        // Process courses one by one
        for (let i = 0; i < courses.length; i++) {
            const course = courses[i];
            if (!course) continue; // Skip if undefined

            const courseKey = `${course.department}-${course.number}`;
            
            // Skip if already processed
            if (processedCourses.has(courseKey)) {
                console.log(`[${i + 1}/${courses.length}] Skipping ${course.department} ${course.number}: ${course.title} (already processed)`);
                continue;
            }
            
            // Skip courses with no prerequisites or corequisites
            if (!course.prerequisites && !course.corequisites) {
                console.log(`\n[${i + 1}/${courses.length}] Skipping ${course.department} ${course.number}: ${course.title} (no prerequisites or corequisites)`);
                continue;
            }

            console.log(`\n[${i + 1}/${courses.length}] Processing ${course.department} ${course.number}: ${course.title}`);
            
            console.log(`  Prerequisites: "${course.prerequisites}"`);
            console.log(`  Corequisites: "${course.corequisites}"`);
            
            const parsed = await parseCourseRequirements(course);
            
            // Extract the raw response from the proper field
            const rawResponse = ('error' in parsed) ? 'Raw response not available for errors' : (parsed.rawResponse || 'Raw response not available');
            
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
            let shouldSave = false;
            let continueLoop = true;
            
            while (continueLoop) {
                console.log('\n  What would you like to do?');
                console.log('  1) Print raw OpenRouter response');
                console.log('  2) Save to database');
                console.log('  3) Skip/Continue (don\'t save)');
                console.log('  q) Quit processing');
                
                const choice = await askUserChoice('  Enter your choice (1/2/3/q): ');
                
                switch (choice.toLowerCase()) {
                    case '1':
                        console.log('\n  📄 Raw OpenRouter Response:');
                        console.log('  ' + '─'.repeat(50));
                        console.log(rawResponse);
                        console.log('  ' + '─'.repeat(50));
                        // Don't exit the loop, go back to menu
                        break;
                        
                    case '2':
                        shouldSave = true;
                        console.log('  💾 Saving to database...');
                        continueLoop = false;
                        break;
                        
                    case '3':
                        console.log('  ⏭️  Continuing without saving...');
                        shouldSave = false;
                        continueLoop = false;
                        break;
                        
                    case 'q':
                        console.log('  👋 Quitting...');
                        rl.close();
                        return;
                        
                    default:
                        console.log('  ⚠️  Invalid choice, please try again...');
                        break;
                }
            }
            
            // Save the result if requested
            // don't save errors
            if (shouldSave && !('error' in parsed)) {
                if ('rawResponse' in parsed) {
                    delete parsed.rawResponse;
                }
                results.push(parsed);
                processedCourses.add(courseKey);
                
                // Save to file immediately
                await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
                console.log(`  ✅ Saved result (total: ${results.length} courses)`);
            }
        }
        
        // Save final results
        await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2), 'utf-8');
        
        // Close readline interface
        rl.close();
        
        // Print summary
        // const successful = results.filter(r => !('error' in r.parsed)).length;
        // const errors = results.filter(r => 'error' in r.parsed).length;
        
        console.log(`\n📊 SUMMARY:`);
        console.log(`   Total processed: ${results.length}`);
        // console.log(`   Successful: ${successful}`);
        // console.log(`   Errors: ${errors}`);
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
