import OpenAI from 'openai';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import * as readline from 'readline';

import type { Course, CourseRequirements, ParsedCourseRequirements, RequirementNode, CourseCondensedInfo, BlacklistedCourse } from './types.ts';
import { prettyPrintRequirement, readablePrintRequirement } from './utilities.js';

// Load environment variables
config();


interface LLMError {
    error: true;
    reason: string;
    confidence: number;
}

type LLMResponse = ParsedCourseRequirements | LLMError;

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

const typesPath = path.join(__dirname, 'source_data/types.md');
const types = await fs.readFile(typesPath, 'utf-8');

const systemPrompt = `You are an expert at parsing university course prerequisites and corequisites from natural language text into structured data.

Your task is to parse the prerequisites and corequisites for a course into a specific JSON schema. 

SCHEMA DEFINITIONS:
- ParsedCourseRequirements: Main output structure 
- RequirementNode: Can be a group (ALL_OF/ONE_OF/TWO_OF logic) or specific requirement types
- Types: 'group', 'course', 'creditCount', 'courseCount', 'CGPA', 'UDGPA', 'HSCourse', 'program', 'permission', 'other'

PARSING RULES:
1. Course numbers like "HSCI 200-level" means level: '2XX'
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
      "note": "Students must apply and receive permission from the co-op coordinator"
    }
11. For credit conflicts in notes (e.g., "Students with credit for ACMA 210 cannot take ACMA 201 for further credit"), extract them into credit_conflicts array:
    {
      "credit_conflicts": [
        { "subject": "ACMA", "course": "210" }
      ]
    }
12. You should only return actual prerequisites or corequisites, not general course information or other notes.
13. Group logic types:
    - ALL_OF: All children must be satisfied (equivalent to AND)
    - ONE_OF: Exactly one child must be satisfied (equivalent to OR)
    - TWO_OF: Exactly two children must be satisfied
14. Do not add words that are not present in the original text.


CONFIDENCE REQUIREMENTS:
- Only return a parsed result if you are highly confident (>85%) in your parsing
- If confidence is low, return an error with specific reasons
- Common reasons for low confidence:
  - Ambiguous wording
  - Complex nested logic that's unclear
  - Unusual abbreviations or terminology
  - Missing context for proper interpretation

OUTPUT FORMAT:
Return ONLY valid JSON - either a ParsedCourseRequirements object or an error object:
You do not have to include spacing or formatting, just the JSON structure.

IMPORTANT: Do NOT include the following fields in your output as they will be added automatically:
- original_title, original_prerequisites, original_corequisites, original_notes
- timestamp
- rawResponse

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
    "rSchema": "SFUv1",
    "prerequisite": {
        "type": "group",
        "logic": "ONE_OF",
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
    "rSchema": "SFUv1",
    "prerequisite": {
        "type": "course",
        "department": "CMPT",
        "number": "383",
        "minGrade": "C-"
    }
}

Note: "Students with credit for ACMA 210 cannot take ACMA 201 for further credit."
{
    "department": "ACMA",
    "number": "201",
    "rSchema": "SFUv1",
    "credit_conflicts": [
        { "subject": "ACMA", "course": "210" }
    ]
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
    const VITAL_DATA_PATH = path.join(__dirname, 'source_data', 'vital_data.json');
    const OUTPUT_PATH = path.join(__dirname, 'generated_data', 'parsed_requirements.json');

    try {
        // Load the vital data
        const vitalDataContent = await fs.readFile(VITAL_DATA_PATH, 'utf-8');
        const courses: CourseCondensedInfo[] = JSON.parse(vitalDataContent);

        console.log(`Processing ${courses.length} courses...`);

        // Load blacklist
        const blacklist = await loadBlacklist();
        console.log(`Loaded ${blacklist.length} blacklisted courses`);

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

            // Skip if blacklisted
            if (isBlacklisted(course, blacklist)) {
                const blacklistEntry = blacklist.find(item =>
                    item.department === course.department && item.course_code === course.number
                );
                console.log(`[${i + 1}/${courses.length}] Skipping ${course.department} ${course.number} (blacklisted)`);
                continue;
            }

            // Skip if already processed
            if (processedCourses.has(courseKey)) {
                console.log(`[${i + 1}/${courses.length}] Skipping ${course.department} ${course.number} (already processed)`);
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
            console.log(`  Notes: "${course.notes}"`);


            const parsed = await parseCourseRequirements(course);

            // Extract the raw response from the proper field
            const rawResponse = ('error' in parsed) ? 'Raw response not available for errors' : (parsed.rawResponse || 'Raw response not available');

            if ('error' in parsed) {
                console.log(`  ❌ Error (confidence: ${parsed.confidence}%): ${parsed.reason}`);
            } else {
                console.log(`  ✅ Successfully parsed (using schema: ${parsed.rSchema})`);
                console.log()
                if (parsed.prerequisite) {
                    console.log(`  📚 Prerequisites:`);
                    console.log(prettyPrintRequirement(parsed.prerequisite, 2));
                    // console.log()
                    // console.log(readablePrintRequirement(parsed.prerequisite, 2));

                }
                if (parsed.corequisite) {
                    console.log(`  🔗 Corequisites:`);
                    console.log(prettyPrintRequirement(parsed.corequisite, 2));
                    // console.log()
                    // console.log(readablePrintRequirement(parsed.corequisite, 2));
                }
                if (parsed.recommended_prerequisite) {
                    console.log(`  📖 Recommended Prerequisites:`);
                    console.log(prettyPrintRequirement(parsed.recommended_prerequisite, 2));
                }
                if (parsed.recommended_corequisite) {
                    console.log(`  📖 Recommended Corequisites:`);
                    console.log(prettyPrintRequirement(parsed.recommended_corequisite, 2));
                }
                if (parsed.credit_conflicts) {
                    console.log(`  ⚠️  Credit Conflicts:`);
                    parsed.credit_conflicts.forEach(conflict => {
                        console.log(`    - ${conflict.subject} ${conflict.course}`);
                    });
                }
            }

            // Sanity check: Ask LLM if the parsed JSON matches the original requirements
            let sanityContent = '';
            const sanityPrompt = `
You are an expert at verifying the logical equivalence of course prerequisite/corequisite requirements.

Given the original course info and the parsed JSON, determine if the parsed JSON is logically equivalent to the original requirements.

Respond with ONLY one of the following options:
1. "Equivalent" - if the JSON matches the requirements.
2. "Ambiguous" - if something is unclear or ambiguous.
3. "Not Equivalent" - if the JSON does not match the requirements.

If ambiguous or not equivalent, briefly explain why.

Notes:
- sometimes in the original course info, the corequisite is also listed in the prerequisite field, which is a problem that we want fixed in our parsed json.

Original course info:
Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Parsed JSON:
${JSON.stringify(parsed, null, 2)}
`;

            try {
                const sanityResponse = await client.chat.completions.create({
                    model: 'google/gemini-2.5-pro',
                    messages: [
                        { role: 'system', content: 'You are a strict logical equivalence checker for course requirements.' },
                        { role: 'user', content: sanityPrompt }
                    ],
                    temperature: 0.1,
                });

                sanityContent = sanityResponse.choices[0]?.message?.content?.trim() || '';
                if (sanityContent) {
                    console.log(`\n  🔎 Sanity Check: ${sanityContent}`);
                } else {
                    console.log('\n  🔎 Sanity Check: No response from LLM');
                }
            } catch (err) {
                console.log('\n  🔎 Sanity Check: Error calling LLM:', err);
            }

            // Schema check using LLM (Gemini Flash)
            // Remove rawResponse before schema validation
            let parsedForSchemaCheck: any = parsed;
            if (parsedForSchemaCheck && typeof parsedForSchemaCheck === 'object' && 'rawResponse' in parsedForSchemaCheck) {
                parsedForSchemaCheck = { ...parsedForSchemaCheck };
                delete parsedForSchemaCheck.rawResponse;
            }
            const schemaCheckPrompt = `
You are a strict JSON schema validator for course requirements.

Given the following JSON object, check if it strictly matches the ParsedCourseRequirements schema as defined below.
- Only check for schema validity (types, required fields, allowed values, structure).
- Do NOT check for logical equivalence or correctness of the requirements.
- If valid, respond with "Valid".
- If invalid, respond with "Invalid" and list all schema violations.

ParsedCourseRequirements schema (TypeScript types):
${types}

JSON to validate:
${JSON.stringify(parsedForSchemaCheck, null, 2)}
`;

            try {
                const schemaCheckResponse = await client.chat.completions.create({
                    model: 'google/gemini-2.5-flash-preview-05-20',
                    messages: [
                        { role: 'system', content: 'You are a strict JSON schema validator.' },
                        { role: 'user', content: schemaCheckPrompt }
                    ],
                    temperature: 0.0,
                });

                const schemaCheckContent = schemaCheckResponse.choices[0]?.message?.content?.trim();
                if (schemaCheckContent) {
                    console.log(`\n  🧩 Schema Check: ${schemaCheckContent}`);
                } else {
                    console.log('\n  🧩 Schema Check: No response from LLM');
                }
            } catch (err) {
                console.log('\n  🧩 Schema Check: Error calling LLM:', err);
            }

            // Interactive prompt for user actions
            let shouldSave = false;
            let continueLoop = true;

            while (continueLoop) {
                console.log('\n  👤 What would you like to do?');
                console.log('  1) Save to database');
                console.log('  2) Blacklist (use sanity check reason)');
                console.log('  3) Blacklist (custom reason)');
                console.log('  4) Skip/Continue (don\'t save)');
                console.log('  5) Print raw OpenRouter response');
                console.log('  q) Quit processing');

                const choice = await askUserChoice('  Enter your choice (1/2/3/4/5/q):  ');

                switch (choice.toLowerCase()) {
                    case '1':
                        shouldSave = true;
                        console.log('  💾 Saving to database...');
                        continueLoop = false;
                        break;

                    case '2':
                        // Blacklist with sanity check reason
                        if (sanityContent && sanityContent !== 'Equivalent') {
                            await addToBlacklist(course.department, course.number, `Sanity check: ${sanityContent}`);
                            console.log('  ⏭️  Continuing after blacklisting...');
                            shouldSave = false;
                            continueLoop = false;
                        } else {
                            console.log('  ⚠️  No sanity check reason available or course was marked as equivalent');
                        }
                        break;

                    case '3':
                        // Blacklist with custom reason
                        const customReason = await askUserChoice('  Enter blacklist reason: ');
                        if (customReason.trim()) {
                            await addToBlacklist(course.department, course.number, customReason.trim());
                            console.log('  ⏭️  Continuing after blacklisting...');
                            shouldSave = false;
                            continueLoop = false;
                        } else {
                            console.log('  ⚠️  Empty reason, please try again');
                        }
                        break;

                    case '4':
                        console.log('  ⏭️  Continuing without saving...');
                        shouldSave = false;
                        continueLoop = false;
                        break;

                    case '5':
                        console.log('\n  📄 Raw OpenRouter Response:');
                        console.log('  ' + '─'.repeat(50));
                        console.log(rawResponse);
                        console.log('  ' + '─'.repeat(50));
                        // Don't exit the loop, go back to menu
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
                // Convert ParsedCourseRequirements to CourseRequirements with metadata
                const enhancedResult: CourseRequirements = {
                    department: parsed.department,
                    number: parsed.number,
                    original_prerequisites: course.prerequisites,
                    original_corequisites: course.corequisites,
                    original_notes: course.notes,
                    rSchema: parsed.rSchema,
                    
                    prerequisite: parsed.prerequisite,
                    corequisite: parsed.corequisite,
                    recommended_prerequisite: parsed.recommended_prerequisite,
                    recommended_corequisite: parsed.recommended_corequisite,
                    credit_conflicts: parsed.credit_conflicts,
                    
                    timestamp: new Date().toISOString()
                };

                results.push(enhancedResult);
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

// Blacklist utility functions
async function loadBlacklist(): Promise<BlacklistedCourse[]> {
    const BLACKLIST_PATH = path.join(__dirname, 'generated_data', 'blacklisted.json');
    try {
        const content = await fs.readFile(BLACKLIST_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.log('No blacklist found, starting with empty blacklist');
        return [];
    }
}

async function saveBlacklist(blacklist: BlacklistedCourse[]): Promise<void> {
    const BLACKLIST_PATH = path.join(__dirname, 'generated_data', 'blacklisted.json');
    await fs.writeFile(BLACKLIST_PATH, JSON.stringify(blacklist, null, 2), 'utf-8');
}

async function addToBlacklist(department: string, courseCode: string, reason: string): Promise<void> {
    const blacklist = await loadBlacklist();
    const newEntry: BlacklistedCourse = {
        department,
        course_code: courseCode,
        reason,
        timestamp: new Date().toISOString()
    };

    // Check if already blacklisted
    const exists = blacklist.find(item =>
        item.department === department && item.course_code === courseCode
    );

    if (exists) {
        console.log(`  ⚠️  Course ${department} ${courseCode} is already blacklisted: ${exists.reason}`);
        return;
    }

    blacklist.push(newEntry);
    await saveBlacklist(blacklist);
    console.log(`  🚫 Added ${department} ${courseCode} to blacklist: ${reason}`);
}

function isBlacklisted(course: CourseCondensedInfo, blacklist: BlacklistedCourse[]): boolean {
    return blacklist.some(item =>
        item.department === course.department && item.course_code === course.number
    );
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
