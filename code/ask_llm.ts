import OpenAI from 'openai';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import * as readline from 'readline';

import type { CreditConflict, CourseRequirements, ParsedCourseRequirements, RequirementNode, CourseCondensedInfo, BlacklistedCourse } from './types.js';
import { prettyPrintRequirement, readablePrintRequirement, validateParsedCourseRequirements } from './utilities.js';
import type { ValidationResult } from './utilities.js';

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
11. For credit conflicts in notes, extract them into credit_conflicts array using these types:
    - For specific course conflicts: { "type": "conflict_course", "subject": "ACMA", "course": "210", "title": "optional course title" }
    - For other complex restrictions: { "type": "conflict_other", "note": "full description text" }
    Examples:
    "Students with credit for ACMA 210 cannot take ACMA 201 for further credit" → 
    { "type": "conflict_course", "subject": "ACMA", "course": "210" }
    
    "BPK major and honours students may not receive credit for BPK 105" →
    { "type": "conflict_other", "note": "BPK major and honours students may not receive credit for BPK 105" }
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
    "r_schema": "SFUv1",
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
    "r_schema": "SFUv1",
    "prerequisite": {
        "type": "course",
        "department": "CMPT",
        "number": "383",
        "minGrade": "C-"
    }
}

Note: "Students with credit for HS 312 cannot take this course for further credit. Students with credit for ARCH 321 under the title "Select Regions in World Archaeology I: Greece" may not take this course for further credit."
[
    {
        "type": "conflict_course",
        "subject": "HS",
        "course": "312"
    },
    {
        "type": "conflict_course",
        "subject": "ARCH",
        "course": "321",
        "title": "Select Regions in World Archaeology I: Greece"
    }
]

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

async function requestRevision(course: CourseCondensedInfo, currentParsed: ParsedCourseRequirements, feedback: string): Promise<LLMResponse> {
    const revisionPrompt = `You are an expert at parsing university course prerequisites and corequisites from natural language text into structured data.

You previously parsed a course's requirements, but the user has provided feedback for improvements. Please revise the JSON output based on the feedback while maintaining accuracy to the original course information.

Original course info:
Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Current parsed JSON:
${JSON.stringify(currentParsed, null, 2)}

User feedback for revision:
${feedback}

Please provide a revised ParsedCourseRequirements JSON that addresses the feedback while staying true to the original course requirements. Follow the same schema and parsing rules as before.

Return ONLY the revised JSON, no explanation needed.

Type definitions follow:
${types}
`;

    try {
        const response = await client.chat.completions.create({
            model: 'google/gemini-2.5-pro',
            messages: [
                { role: 'system', content: 'You are an expert course requirements parser. Revise the JSON based on user feedback while maintaining accuracy.' },
                { role: 'user', content: revisionPrompt }
            ],
            temperature: 0.1,
        });

        const content = response.choices[0]?.message?.content;
        const rawResponseContent = content || 'No response received';

        if (!content) {
            return {
                error: true,
                reason: 'No response from LLM for revision',
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

            const parsed = JSON.parse(cleanContent) as ParsedCourseRequirements;
            // Store the raw response from this revision
            parsed.rawResponse = rawResponseContent;
            return parsed;
        } catch (parseError) {
            return {
                error: true,
                reason: `Failed to parse revised LLM response as JSON: ${parseError} - Response: ${content}`,
                confidence: 0
            };
        }

    } catch (error) {
        return {
            error: true,
            reason: `Revision API call failed: ${error}`,
            confidence: 0
        };
    }
}

async function requestRevisionFromError(course: CourseCondensedInfo, currentError: LLMError, feedback: string): Promise<LLMResponse> {
    const revisionPrompt = `You are an expert at parsing university course prerequisites and corequisites from natural language text into structured data.

You previously attempted to parse a course's requirements but encountered an error or low confidence. The user has provided feedback to help you try again.

Original course info:
Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Previous error:
Reason: ${currentError.reason}
Confidence: ${currentError.confidence}%

User feedback to help with parsing:
${feedback}

Please attempt to parse the course requirements again, taking into account the user's feedback. If you're still not confident enough (>85%), return an error with updated reasoning.

Return ONLY valid JSON - either a ParsedCourseRequirements object or an error object.

IMPORTANT: Do NOT include the following fields in your output as they will be added automatically:
- original_title, original_prerequisites, original_corequisites, original_notes
- timestamp
- rawResponse

Type definitions follow:
${types}
`;

    try {
        const response = await client.chat.completions.create({
            model: 'google/gemini-2.5-pro',
            messages: [
                { role: 'system', content: 'You are an expert course requirements parser. Try again based on user feedback, but only return results if highly confident.' },
                { role: 'user', content: revisionPrompt }
            ],
            temperature: 0.1,
        });

        const content = response.choices[0]?.message?.content;
        const rawResponseContent = content || 'No response received';

        if (!content) {
            return {
                error: true,
                reason: 'No response from LLM for error revision',
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
                reason: `Failed to parse revised LLM response as JSON: ${parseError} - Response: ${content}`,
                confidence: 0
            };
        }

    } catch (error) {
        return {
            error: true,
            reason: `Error revision API call failed: ${error}`,
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

            // Track all LLM responses for this course
            const llmResponses: { type: string; response: string; timestamp: string }[] = [];

            let parsed = await parseCourseRequirements(course);

            // Store the initial parsing response
            const initialRawResponse = ('error' in parsed) ? 'Raw response not available for errors' : (parsed.rawResponse || 'Raw response not available');
            llmResponses.push({
                type: 'Initial Parsing',
                response: initialRawResponse,
                timestamp: new Date().toISOString()
            });

            // Extract the raw response from the proper field
            const rawResponse = ('error' in parsed) ? 'Raw response not available for errors' : (parsed.rawResponse || 'Raw response not available');

            if ('error' in parsed) {
                console.log(`  ❌ Error (confidence: ${parsed.confidence}%): ${parsed.reason}`);
            } else {
                console.log(`  ✅ Successfully parsed (using schema: ${parsed.r_schema})`);
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
                        if (conflict.type === 'conflict_course') {
                            const title = conflict.title ? ` (${conflict.title})` : '';
                            console.log(`    - Equivalent: ${conflict.subject} ${conflict.course}${title}`);
                        } else if (conflict.type === 'conflict_other') {
                            console.log(`    - Other: ${conflict.note}`);
                        }
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
                
                // Store the sanity check response
                llmResponses.push({
                    type: 'Sanity Check',
                    response: sanityContent || 'No response from LLM',
                    timestamp: new Date().toISOString()
                });
                
                if (sanityContent) {
                    console.log(`\n  🔎 Sanity Check: ${sanityContent}`);
                } else {
                    console.log('\n  🔎 Sanity Check: No response from LLM');
                }
            } catch (err) {
                llmResponses.push({
                    type: 'Sanity Check',
                    response: `Error calling LLM: ${err}`,
                    timestamp: new Date().toISOString()
                });
                console.log('\n  🔎 Sanity Check: Error calling LLM:', err);
            }

            // Schema validation using code-based validation
            // Remove rawResponse before schema validation
            let parsedFor_schemaCheck: any = parsed;
            if (parsedFor_schemaCheck && typeof parsedFor_schemaCheck === 'object' && 'rawResponse' in parsedFor_schemaCheck) {
                parsedFor_schemaCheck = { ...parsedFor_schemaCheck };
                delete parsedFor_schemaCheck.rawResponse;
            }

            const validationResult: ValidationResult = validateParsedCourseRequirements(parsedFor_schemaCheck);
            
            let schemaCheckContent: string;
            if (validationResult.isValid) {
                schemaCheckContent = 'Valid';
            } else {
                schemaCheckContent = `Invalid - Schema violations:\n${validationResult.errors.map(error => `  • ${error}`).join('\n')}`;
            }
            
            // Store the schema check response
            llmResponses.push({
                type: 'Schema Check',
                response: schemaCheckContent,
                timestamp: new Date().toISOString()
            });
            
            console.log(`\n  🧩 Schema Check: ${schemaCheckContent}`);

            // Interactive prompt for user actions
            let shouldSave = false;
            let continueLoop = true;

            while (continueLoop) {
                console.log('\n  👤 What would you like to do?');
                console.log('  Enter) Save to database');
                console.log('  2) Blacklist (use sanity check reason)');
                console.log('  3) Blacklist (custom reason)');
                console.log('  4) Skip/Continue (don\'t save)');
                console.log('  5) Print all LLM responses');
                console.log('  6) Request revision');
                console.log('  q) Quit processing');

                const choice = await askUserChoice('  Enter your choice (Enter/2/3/4/5/6/q):    ');

                switch (choice.toLowerCase()) {
                    case '':
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
                        console.log('\n  📄 All LLM Responses for this course:');
                        console.log('  ' + '═'.repeat(60));
                        
                        llmResponses.forEach((response, index) => {
                            console.log(`\n  ${index + 1}. ${response.type} (${response.timestamp})`);
                            console.log('  ' + '─'.repeat(50));
                            console.log(response.response);
                        });
                        
                        console.log('  ' + '═'.repeat(60));
                        // Don't exit the loop, go back to menu
                        break;

                    case '6':
                        // Request revision from Gemini Pro
                        const revisionFeedback = await askUserChoice('  Enter your feedback for revision: ');
                        if (!revisionFeedback.trim()) {
                            console.log('  ⚠️  Empty feedback, returning to menu');
                            break;
                        }
                        
                        console.log('  🔄 Requesting revision...');
                        let revisedResult: LLMResponse;
                        
                        if ('error' in parsed) {
                            // Handle revision for error responses
                            revisedResult = await requestRevisionFromError(course, parsed, revisionFeedback.trim());
                        } else {
                            // Handle revision for successful responses
                            revisedResult = await requestRevision(course, parsed, revisionFeedback.trim());
                        }
                        
                        // Store the revision response
                        if ('error' in revisedResult) {
                            llmResponses.push({
                                type: 'Revision Request',
                                response: `Error: ${revisedResult.reason}`,
                                timestamp: new Date().toISOString()
                            });
                        } else {
                            llmResponses.push({
                                type: 'Revision Request',
                                response: revisedResult.rawResponse || 'Raw response not available',
                                timestamp: new Date().toISOString()
                            });
                        }
                        
                        if ('error' in revisedResult) {
                            console.log(`  ❌ Revision failed: ${revisedResult.reason}`);
                        } else {
                            console.log('  ✅ Revision completed! Updated parsed result:');
                            // Replace the parsed result with the revision (don't merge, replace completely)
                            parsed = revisedResult;
                            
                            // Perform schema validation on the revised result
                            let revisedFor_schemaCheck: any = parsed;
                            if (revisedFor_schemaCheck && typeof revisedFor_schemaCheck === 'object' && 'rawResponse' in revisedFor_schemaCheck) {
                                revisedFor_schemaCheck = { ...revisedFor_schemaCheck };
                                delete revisedFor_schemaCheck.rawResponse;
                            }

                            const revisionValidationResult: ValidationResult = validateParsedCourseRequirements(revisedFor_schemaCheck);
                            
                            let revisionSchemaCheckContent: string;
                            if (revisionValidationResult.isValid) {
                                revisionSchemaCheckContent = 'Valid';
                            } else {
                                revisionSchemaCheckContent = `Invalid - Schema violations:\n${revisionValidationResult.errors.map(error => `  • ${error}`).join('\n')}`;
                            }
                            
                            // Store the revision schema check response
                            llmResponses.push({
                                type: 'Revision Schema Check',
                                response: revisionSchemaCheckContent,
                                timestamp: new Date().toISOString()
                            });
                            
                            console.log(`\n  🧩 Revision Schema Check: ${revisionSchemaCheckContent}`);
                            
                            // Display the updated result - only if it's not an error
                            if (!('error' in parsed)) {
                                if (parsed.prerequisite) {
                                    console.log(`  📚 Prerequisites:`);
                                    console.log(prettyPrintRequirement(parsed.prerequisite, 2));
                                }
                                if (parsed.corequisite) {
                                    console.log(`  🔗 Corequisites:`);
                                    console.log(prettyPrintRequirement(parsed.corequisite, 2));
                                }
                                if (parsed.credit_conflicts) {
                                    console.log(`  ⚠️  Credit Conflicts:`);
                                    parsed.credit_conflicts.forEach(conflict => {
                                        if (conflict.type === 'conflict_course') {
                                            const title = conflict.title ? ` (${conflict.title})` : '';
                                            console.log(`    - Course: ${conflict.subject} ${conflict.course}${title}`);
                                        } else if (conflict.type === 'conflict_other') {
                                            console.log(`    - Other: ${conflict.note}`);
                                        }
                                    });
                                }
                            }
                        }
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
                    original_title: course.title,
                    original_prerequisites: course.prerequisites,
                    original_corequisites: course.corequisites,
                    original_notes: course.notes,
                    r_schema: parsed.r_schema,
                    
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
export { parseCourseRequirements, requestRevision, requestRevisionFromError, processAllCourses };

// Run if this file is executed directly
if (import.meta.main) {
    main().catch(console.error);
}
