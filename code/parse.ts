/*
This file defines an async function called main that processes a list of course data, extracts requirements, and saves the results. Here’s a step-by-step summary:

API Key Check:
It first checks for the OPENROUTER_API_KEY environment variable. If missing, it logs an error and exits.

Load Data:

Loads course data from a JSON file (vital_data.json).
Loads previously processed results.
Loads a blacklist of courses to skip.
Processing Loop:
For each course:

Skips if the course is blacklisted.
Skips if the course has no prerequisites or corequisites.
Skips if the course was already processed and is up to date.
Otherwise, processes the course (likely parsing requirements).
Updates the results and saves them immediately.
Statistics & Logging:

Tracks stats: total, processed, skipped, successful, failed, and errors.
Logs progress and a summary at the end.
Purpose:
Automates the parsing and updating of course requirements, ensuring only new or changed courses are processed, and saves the results for further use.

Gotchas:

Exits if the API key is missing.
Saves results after each successful course, which may be slow for large datasets.
Relies on helper functions (loadExistingResults, processCourse, etc.) not shown here.
Let me know if you want a breakdown of any specific part!



*/

import OpenAI from 'openai';
import { config } from 'dotenv';
import { promises as fs } from 'fs';
import path from 'path';
import * as readline from 'readline';

import type { CourseCondensedInfo, CourseRequirements, ParsedCourseRequirements, BlacklistedCourse } from './types.js';
import type {
    ParseResult,
    ProcessingStats,
    CourseProcessingResult,
    AmbiguityCheckResult,
    LLMResponse,
    RetryContext
} from './types.js';
import { examples } from './examples.js';
import { prettyPrintCourseRequirements, validateParsedCourseRequirements } from './utilities.js';
import type { ValidationResult } from './utilities.js';
import assert from 'assert';

// Load environment variables
config();

const LLM_MODEL = "google/gemini-2.5-flash-lite-preview-06-17";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

// Create readline interface for human interaction
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

// Load environment variables
config();

// Load types for system prompt
const typesPath = path.join(__dirname, 'source_data/types.md');
const types = await fs.readFile(typesPath, 'utf-8');


// const examplesText = examples.map((ex: typeof examples[number]) => `
// Example: "${ex.example}"
// Output: ${JSON.stringify(ex.json, null, 2)}
// `).join('\n');



// Create system prompt with relevant examples
function createSystemPrompt(relevantExamples: typeof examples): string {
    const examplesText = formatExamplesForPrompt(relevantExamples);

    return `You are an expert at parsing university course prerequisites and corequisites from natural language text into structured data.

Your task is to parse the prerequisites and corequisites for a course into a specific JSON schema.

You must follow the following schema in your output:
${types}

PARSING RULES:
1. Course numbers like "HSCI 200-level" means department: 'HSCI', level: '2XX'
2. "Upper division" = level: 'UD', "Lower division" = level: 'LD'
3. "60 units" or "60 credits" = creditCount with credits: 60
4. "Two courses" = courseCount with count: 2
5. "may be taken concurrently" = canBeTakenConcurrently: 'true'
6. "or equivalent" = orEquivalent: 'true'
7. Extract minimum grades like "C-", "B+", etc.
8. Parse CGPA requirements like "CGPA of 2.50"
9. Parse program requirements like "Faculty of Science"
10. For permission requirements, use type: "permission" with note field
11. For credit conflicts in notes, extract them into credit_conflicts array
12. Group logic types: ALL_OF, ONE_OF, TWO_OF
13. If there is information that is not prerequisite, corequisite,reccomended prerequisite/corequisite, or course conflict, do not include it in the output.

CONFIDENCE REQUIREMENTS:
- Only return a parsed result if you are mediumly confident (>85%) in your parsing
- If confidence is low, return an error with specific reasons

OUTPUT FORMAT:
Return ONLY valid JSON - either a ParsedCourseRequirements object or an error object.

Follow the format given in the correct parsing examples below.
${examplesText}`;
}

// Step 2: Parse requirements with LLM
// Step 1: Check for ambiguity before parsing (no JSON generation)
async function checkForAmbiguityInCourseDescription(course: CourseCondensedInfo, examplesForCourse: typeof examples, llmResponses?: Array<any>): Promise<AmbiguityCheckResult> {
    const examplesText = formatExamplesForPrompt(examplesForCourse);

    const ambiguityPrompt = `You are an expert at analyzing university course prerequisites and corequisites for parsing feasibility.

Typing system:
${types}

EXAMPLES OF WHAT THE SCHEMA CAN HANDLE:
${examplesText}

Given the course information below, determine if the requirements can be clearly and unambiguously represented using the provided schema and examples. Look for any language that is unclear, contradictory, or cannot be represented with the schema.

Course to analyze:
Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Respond with ONLY one of the following:
1. "CLEAR" - if the requirements can be unambiguously represented with the schema
2. "AMBIGUOUS" - if there is any language that is unclear, contradictory, or cannot be represented with the schema

If AMBIGUOUS, briefly explain why (missing schema support, contradictory statements, unclear language, etc.). Also, please quote the specific text that causes the ambiguity.

However, please be creative in your analysis and do not just say "ambiguous" for every course. Use the examples provided to determine if the requirements can be clearly represented.

Known data issues:
- any text that mentions completing a prerequisite during a specific semester is not supported
- Equivalent courses are not supported

Response:`;

    try {
        const response = await client.chat.completions.create({
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: 'You are a requirements analysis expert. Determine if course requirements can be clearly represented in the given schema.' },
                { role: 'user', content: ambiguityPrompt }
            ],
            temperature: 0.1,
            reasoning_effort: 'medium',
        });

        const content = response.choices[0]?.message?.content?.trim() || '';

        // Save LLM response if tracking array is provided
        if (llmResponses) {
            llmResponses.push({
                step: 'Ambiguity Check',
                attempt: 1,
                prompt: ambiguityPrompt,
                fullPrompt: ambiguityPrompt, // Save complete prompt with substitutions
                response: content,
                success: content.startsWith('CLEAR'),
                error: content.startsWith('CLEAR') ? undefined : content,
                relevantExamples: examplesForCourse.length
            });
        }

        if (content.startsWith('CLEAR')) {
            return { passed: true };
        } else {
            return {
                passed: false,
                reason: content.replace('AMBIGUOUS', '').trim() || 'Requirements cannot be clearly represented',
                confidence: 25
            };
        }
    } catch (error) {
        if (llmResponses) {
            llmResponses.push({
                step: 'Ambiguity Check',
                attempt: 1,
                prompt: ambiguityPrompt,
                fullPrompt: ambiguityPrompt, // Save complete prompt with substitutions
                response: `API Error: ${error}`,
                success: false,
                error: `Error during ambiguity check: ${error}`,
                relevantExamples: examplesForCourse.length
            });
        }

        return {
            passed: false,
            reason: `Error during ambiguity check: ${error}`,
            confidence: 0
        };
    }
}

// Step 2: Parse requirements with LLM
async function parseRequirements(course: CourseCondensedInfo, examplesForCourse: typeof examples, llmResponses?: Array<any>, attemptNum: number = 1): Promise<LLMResponse> {
    const systemPrompt = createSystemPrompt(examplesForCourse);

    const userPrompt = `Parse the prerequisites and corequisites for this course:

Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Return the parsed requirements JSON or an error if not confident enough.`;

    try {
        const response = await client.chat.completions.create({
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            reasoning_effort: 'medium',
        });

        const content = response.choices[0]?.message?.content;

        if (!content) {
            const errorMsg = 'No response from LLM';
            if (llmResponses) {
                llmResponses.push({
                    step: 'Parse Requirements',
                    attempt: attemptNum,
                    prompt: userPrompt,
                    fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${userPrompt}`, // Save complete prompt with substitutions
                    response: 'No response',
                    success: false,
                    error: errorMsg,
                    relevantExamples: examplesForCourse.length
                });
            }
            return {
                error: true,
                reason: errorMsg,
            };
        }

        // Save raw response
        if (llmResponses) {
            llmResponses.push({
                step: 'Parse Requirements',
                attempt: attemptNum,
                prompt: userPrompt,
                fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${userPrompt}`, // Save complete prompt with substitutions
                response: content,
                success: true,
                relevantExamples: examplesForCourse.length
            });
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

            // Add required fields if successful parse
            if (!('error' in parsed)) {
                parsed.department = course.department;
                parsed.number = course.number;
                parsed.schema_version = 'SFUv1.1';
            }

            return parsed;
        } catch (parseError) {
            const errorMsg = `Failed to parse LLM response as JSON: ${parseError} - Response: ${content}`;
            if (llmResponses) {
                llmResponses[llmResponses.length - 1].success = false;
                llmResponses[llmResponses.length - 1].error = errorMsg;
            }
            return {
                error: true,
                reason: errorMsg,
            };
        }

    } catch (error) {
        const errorMsg = `API call failed: ${error}`;
        if (llmResponses) {
            llmResponses.push({
                step: 'Parse Requirements',
                attempt: attemptNum,
                prompt: userPrompt,
                fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${userPrompt}`, // Save complete prompt with substitutions
                response: `API Error: ${error}`,
                success: false,
                error: errorMsg,
                relevantExamples: examplesForCourse.length
            });
        }
        return {
            error: true,
            reason: errorMsg,
        };
    }
}

interface LLMValidationResponse {
    isValid: boolean;
    reason?: string;
    suggestedChanges?: ParsedCourseRequirements;
}

// Step 3: Validate the parsed JSON with LLM
async function validateWithLLM(
    course: CourseCondensedInfo,
    parsed: ParsedCourseRequirements,
    examplesForCourse: typeof examples,
    llmResponses?: Array<any>,
    attemptNum: number = 1
): Promise<LLMValidationResponse> {
    const validationPrompt = `You are validating if a parsed JSON correctly represents course requirements.

TASK: Compare the original text with the parsed JSON. Are they logically equivalent?

ORIGINAL COURSE INFO:
Course: ${course.department} ${course.number} - ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

PARSED JSON:
${JSON.stringify(parsed, null, 2)}

VALIDATION RULES:
1. All courses mentioned in the original text should appear in the JSON
2. All grade requirements should be correctly assigned
3. Logical words like "and" = ALL_OF, "or" = ONE_OF should match
4. Credit conflicts in notes should be in credit_conflicts array
5. Only flag as INVALID if there are actual logical errors
6. If a corequisite is in the prerequisite field in the original course info, it should be treated as a corequisite in the JSON

Respond with:
- "VALID" if the JSON correctly represents the original text
- "INVALID [reason]" if there are logical errors, then provide corrected JSON

You are allowed to have some flexibility in interpretation (eg synonyms or common sense), but you must be confident that the requirements can be represented without ambiguity.


Response:`;

    try {
        const response = await client.chat.completions.create({
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: 'You are a strict logical equivalence checker for course requirements.' },
                { role: 'user', content: validationPrompt }
            ],
            temperature: 0.1,
            reasoning_effort: 'medium',
            max_completion_tokens: 10000
        });

        const content = response.choices[0]?.message?.content?.trim() || '';

        // Save LLM response
        if (llmResponses) {
            llmResponses.push({
                step: 'LLM Validation',
                attempt: attemptNum,
                prompt: validationPrompt,
                fullPrompt: validationPrompt, // Save complete prompt with substitutions
                response: content,
                success: content.startsWith('VALID'),
                error: content.startsWith('VALID') ? undefined : content,
                relevantExamples: examplesForCourse.length
            });
        }

        if (content.startsWith('VALID')) {
            return { isValid: true };

        } else {
            // Try to extract suggested JSON from the response, if present
            let suggestedChanges: ParsedCourseRequirements | undefined = undefined;

            // Look for a JSON code block in the response
            const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
            const match = codeBlockRegex.exec(content);

            if (match && match[1]) {
                try {
                    suggestedChanges = JSON.parse(match[1]);
                    
                    // Check if suggested changes are identical to original parse
                    if (suggestedChanges && JSON.stringify(suggestedChanges, null, 2) === JSON.stringify(parsed, null, 2)) {
                        console.log('   🔍 LLM suggested identical JSON - treating as VALID');
                        return { isValid: true };
                    }
                } catch {
                    // Ignore parse error, leave suggestedChanges undefined
                }
            }

            // Remove "INVALID" and any code block from the reason
            const reason = content
                .replace(/^INVALID\s*/i, '')
                .replace(codeBlockRegex, '')
                .trim() || 'JSON does not match requirements';

            return {
                isValid: false,
                reason,
                suggestedChanges
            };
        }
    } catch (error) {
        const errorMsg = `Error during LLM validation: ${error}`;
        if (llmResponses) {
            llmResponses.push({
                step: 'LLM Validation',
                attempt: attemptNum,
                prompt: validationPrompt,
                fullPrompt: validationPrompt, // Save complete prompt with substitutions
                response: `API Error: ${error}`,
                success: false,
                error: errorMsg,
                relevantExamples: examplesForCourse.length
            });
        }

        return {
            isValid: false,
            reason: errorMsg
        };
    }
}

// Step 4: Retry with feedback
async function retryParseWithFeedback(course: CourseCondensedInfo, examplesForCourse: typeof examples, previousParsed: ParsedCourseRequirements, validationFeedback: string, llmResponses?: Array<any>, attemptNum: number = 1): Promise<LLMResponse> {
    const systemPrompt = createSystemPrompt(examplesForCourse);

    const retryPrompt = `You previously parsed course requirements but the validation failed. Please correct the parsing based on this feedback:

VALIDATION FEEDBACK: ${validationFeedback}

Original course info:
Department: ${course.department}
Number: ${course.number}
Title: ${course.title}
Prerequisites: "${course.prerequisites}"
Corequisites: "${course.corequisites}"
Notes: "${course.notes}"

Previous parsed JSON:
${JSON.stringify(previousParsed, null, 2)}

Please provide a corrected ParsedCourseRequirements JSON that addresses the validation feedback.`;

    try {
        const response = await client.chat.completions.create({
            model: LLM_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: retryPrompt }
            ],
            temperature: 0.1,
            reasoning_effort: 'medium',
        });

        const content = response.choices[0]?.message?.content;

        if (!content) {
            const errorMsg = 'No response from LLM on retry';
            if (llmResponses) {
                llmResponses.push({
                    step: 'Retry Parse',
                    attempt: attemptNum,
                    prompt: retryPrompt,
                    fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${retryPrompt}`, // Save complete prompt with substitutions
                    response: 'No response',
                    success: false,
                    error: errorMsg,
                    relevantExamples: examplesForCourse.length
                });
            }
            return {
                error: true,
                reason: errorMsg,
            };
        }

        // Save raw response
        if (llmResponses) {
            llmResponses.push({
                step: 'Retry Parse',
                attempt: attemptNum,
                prompt: retryPrompt,
                fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${retryPrompt}`, // Save complete prompt with substitutions
                response: content,
                success: true,
                relevantExamples: examplesForCourse.length
            });
        }

        // Parse the JSON response
        try {
            let cleanContent = content.trim();
            if (cleanContent.startsWith('```json')) {
                cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanContent.startsWith('```')) {
                cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            const parsed = JSON.parse(cleanContent) as LLMResponse;

            // Add required fields if successful parse
            if (!('error' in parsed)) {
                parsed.department = course.department;
                parsed.number = course.number;
                parsed.schema_version = 'SFUv1.1';
            }

            return parsed;
        } catch (parseError) {
            const errorMsg = `Failed to parse retry response as JSON: ${parseError}`;
            if (llmResponses) {
                llmResponses[llmResponses.length - 1].success = false;
                llmResponses[llmResponses.length - 1].error = errorMsg;
            }
            return {
                error: true,
                reason: errorMsg,
            };
        }

    } catch (error) {
        const errorMsg = `Retry API call failed: ${error}`;
        if (llmResponses) {
            llmResponses.push({
                step: 'Retry Parse',
                attempt: attemptNum,
                prompt: retryPrompt,
                fullPrompt: `SYSTEM PROMPT:\n${systemPrompt}\n\nUSER PROMPT:\n${retryPrompt}`, // Save complete prompt with substitutions
                response: `API Error: ${error}`,
                success: false,
                error: errorMsg
            });
        }
        return {
            error: true,
            reason: errorMsg,
        };
    }
}

// Step 5: Human interactive interface
async function humanInteraction(course: CourseCondensedInfo, lastParsed?: ParsedCourseRequirements, error?: string, llmResponses?: Array<any>): Promise<'skip' | 'blacklist'> {
    // Save debug information before human interaction
    if (llmResponses && llmResponses.length > 0) {
        const courseKey = `${course.department} ${course.number}`;
        await saveLLMDebugInfo(courseKey, llmResponses);
    }

    console.log('\n' + '='.repeat(80));
    console.log('🤖 HUMAN INTERACTION REQUIRED');
    console.log('='.repeat(80));
    console.log(`Course: ${course.department} ${course.number} - ${course.title}`);
    console.log(`Prerequisites: "${course.prerequisites}"`);
    console.log(`Corequisites: "${course.corequisites}"`);
    console.log(`Notes: "${course.notes}"`);

    if (error) {
        console.log(`\nError: ${error}`);
    }

    if (lastParsed) {
        console.log('\nLast parsed JSON:');
        console.log(JSON.stringify(lastParsed, null, 2));
    }

    // Print all LLM responses for debugging
    if (llmResponses && llmResponses.length > 0) {
        console.log('\n' + '='.repeat(80));
        console.log('🧠 LLM RESPONSES DEBUG INFO');
        console.log('='.repeat(80));

        llmResponses.forEach((response, index) => {
            console.log(`\n--- Response ${index + 1}: ${response.step} (Attempt ${response.attempt}) ---`);
            console.log(`Success: ${response.success ? '✅' : '❌'}`);
            if (response.relevantExamples !== undefined) {
                console.log(`Relevant Examples Used: ${response.relevantExamples}`);
            }
            if (response.error) {
                console.log(`Error: ${response.error}`);
            }
            console.log('\nFull Prompt (with substitutions):');
            console.log(response.fullPrompt);
            console.log('\nResponse:');
            console.log(response.response);
            console.log('-'.repeat(40));
        });

        console.log('\n' + '='.repeat(80));
    }

    console.log('\nOptions:');
    console.log('1) Skip this course');
    console.log('2) Blacklist this course');

    while (true) {
        const choice = await askUserChoice('Enter your choice (1 or 2): ');

        switch (choice) {
            case '1':
                console.log('Skipping course...\n');
                return 'skip';
            case '2':
                const reason = await askUserChoice('Enter blacklist reason: ');
                await addToBlacklist(course.department, course.number, reason || 'Manual blacklist via human interaction');
                console.log('Added to blacklist...\n');
                return 'blacklist';
            default:
                console.log('Invalid choice. Please enter 1 or 2.');
        }
    }
}

async function processCourse(course: CourseCondensedInfo): Promise<ParseResult> {
    // Track all LLM responses for debugging
    const llmResponses: Array<{
        step: string;
        attempt: number;
        prompt: string;
        fullPrompt: string; // Complete prompt with all substitutions
        response: string;
        success: boolean;
        error?: string;
        relevantExamples?: number;
    }> = [];

    // Step 0: Generate examples for this course text
    // We do this to save tokens so we don't have to send the entire examples list
    const courseText = [
        "prerequisite: " + course.prerequisites || '',
        "corequisites: " + course.corequisites || '',
        "notes:" + course.notes || ''
    ].join(' ').toLowerCase();

    const examplesForCourse = examples.filter(ex =>
        courseText.toLowerCase().includes(ex.keyword.toLowerCase())
    );

    // Check if there are examples for this course
    if (examplesForCourse.length === 0) {
        console.error(`\nERROR: No relevant examples found for course ${course.department} ${course.number}`);
        // console.error(`Course text: "${courseText}"`);
        // console.error(`Available keywords: ${examples.map(ex => ex.keyword).join(', ')}`);
        // Instead of exiting, skip this course gracefully
        console.log(`⏭️  Skipping (no relevant examples found)`);
        return {
            success: false,
            error: 'No relevant examples found for this course',
            confidence: 0,
            attempts: 0,
            schemaValid: false,
            ambiguityCheckPassed: false
        };
    }

    console.log()
    console.log(`📑 Using ${examplesForCourse.length} relevant examples (of ${examples.length}).`)

    // Step 1: Check for ambiguity in text before parsing
    console.log(`1️⃣  Asking LLM to look for ambiguity...`);
    const ambiguityCheck = await checkForAmbiguityInCourseDescription(course, examplesForCourse, llmResponses)

    if (!ambiguityCheck.passed) {
        console.log(`❌ Ambiguity in course description detected: ${ambiguityCheck.reason}`);

        // await askUserChoice('Press Enter to continue...');

        // Add to blacklist if ambiguity is found
        await addToBlacklist(course.department, course.number, `Ambiguity issue: ${ambiguityCheck.reason}`);

        const courseKey = `${course.department} ${course.number}`;
        await saveLLMDebugInfo(courseKey, llmResponses);

        return {
            success: false,
            error: ambiguityCheck.reason,
            confidence: ambiguityCheck.confidence || 0,
            attempts: 1,
            schemaValid: false,
            ambiguityCheckPassed: false
        };
    }

    console.log(`   ✅ Ambiguity check passed.`);

    // Step 2: Parse requirements with LLM (first attempt)
    console.log(`2️⃣  Parsing requirements...`);
    let parsed = await parseRequirements(course, examplesForCourse, llmResponses, 1);

    // Check if LLM returned an error
    if ('error' in parsed) {
        console.log(`❌ LLM Error: ${parsed.reason}`);

        // Go directly to human interaction
        await askUserChoice('Press Enter to continue...');

        
        const humanDecision = await humanInteraction(course, undefined, parsed.reason, llmResponses);

        const courseKey = `${course.department} ${course.number}`;
        await saveLLMDebugInfo(courseKey, llmResponses);

        return {
            success: false,
            error: `Failed with human decision: ${humanDecision}`,
            confidence: 0,
            attempts: 1,
            schemaValid: false,
            ambiguityCheckPassed: true
        };
    }

    console.log(`   ✅ Course parsed.`);

    // Step 3: Validate parsed JSON locally
    console.log(`3️⃣  Validating schema...`);

    const validationResult: ValidationResult = validateParsedCourseRequirements(parsed);
    if (!validationResult.isValid) {
        const schemaError = `Schema validation failed: ${validationResult.errors.join(', ')}`;
        console.log(`   ❌ ${schemaError}`);

        // // Try one retry with feedback if we have a valid parsed structure
        // if ('prerequisites' in parsed || 'corequisites' in parsed) {
        //     console.log(`    Step 2b: Retry with schema feedback...`);
        //     const retryParsed = await retryParseWithFeedback(course, examplesForCourse, parsed as ParsedCourseRequirements, schemaError, llmResponses, 2);

        //     if (!('error' in retryParsed)) {
        //         const retryValidation = validateParsedCourseRequirements(retryParsed);
        //         if (retryValidation.isValid) {
        //             parsed = retryParsed;
        //             console.log(`      ✅ Schema validation passed on retry`);
        //         } else {
        //             console.log(`      ❌ Schema validation failed on retry`);
        //             const humanDecision = await humanInteraction(course, retryParsed as ParsedCourseRequirements, `Retry schema validation failed: ${retryValidation.errors.join(', ')}`, llmResponses);

        //             return {
        //                 success: false,
        //                 error: `Failed with human decision: ${humanDecision}`,
        //                 confidence: 0,
        //                 attempts: 2,
        //                 schemaValid: false,
        //                 ambiguityCheckPassed: true
        //             };
        //         }
        //     } else {
        //         console.log(`      ❌ Retry parse failed: ${retryParsed.reason}`);
        //         const humanDecision = await humanInteraction(course, parsed as ParsedCourseRequirements, `Original error: ${schemaError}, Retry error: ${retryParsed.reason}`, llmResponses);

        //         return {
        //             success: false,
        //             error: `Failed with human decision: ${humanDecision}`,
        //             confidence: 0,
        //             attempts: 2,
        //             schemaValid: false,
        //             ambiguityCheckPassed: true
        //         };
        //     }
        // } else {
        //     // No valid structure to retry with
        //     const humanDecision = await humanInteraction(course, undefined, schemaError, llmResponses);

        //     return {
        //         success: false,
        //         error: `Failed with human decision: ${humanDecision}`,
        //         confidence: 0,
        //         attempts: 1,
        //         schemaValid: false,
        //         ambiguityCheckPassed: true
        //     };
        // }
    } else {
        console.log(`   ✅ Schema validation passed`);
    }

    // Step 4: Validate with LLM
    console.log(`4️⃣  LLM validation...`);
    const llmValidation = await validateWithLLM(course, parsed, examplesForCourse, llmResponses, 1);
    if (!llmValidation.isValid) {
        const llmError = `LLM validation failed: ${llmValidation.reason}`;

        console.log(`   ❌ ${llmError}`);

        // console.log(llmValidation)
        if (llmValidation.suggestedChanges) {
            console.log()
            console.log(`Suggested changes from LLM:`);
            console.log(prettyPrintCourseRequirements(llmValidation.suggestedChanges));
        }
        
        console.log()
        console.log("Initial parse result:");
        console.log(prettyPrintCourseRequirements(parsed));
        console.log()
        // Wait for user input before continuing
        // await askUserChoice('Press Enter to continue...');

    } else {
        console.log(`   ✅ LLM validation passed`);
        console.log()
        console.log(prettyPrintCourseRequirements(parsed));
        console.log()

        // Wait for 2 seconds before proceeding
        // await askUserChoice('Press Enter to continue...');
        // await new Promise(resolve => setTimeout(resolve, 2000));
    }


    // Save debug information
    const courseKey = `${course.department} ${course.number}`;
    await saveLLMDebugInfo(courseKey, llmResponses);

    // Success!
    if (llmValidation.isValid && validationResult.isValid) {
        return {
            success: true,
            data: parsed,
            attempts: 1,
            schemaValid: true,
            ambiguityCheckPassed: true
        };

    } else {
        // This should not happen if we reached this point, but just in case
        return {
            success: false,
            error: 'Failed to parse course.',
            confidence: 0,
            attempts: 1,
            schemaValid: false,
            ambiguityCheckPassed: true
        };
    }

}

// Helper function to format examples for LLM prompts
function formatExamplesForPrompt(relevantExamples: typeof examples): string {
    if (relevantExamples.length === 0) {
        return "No specific examples match this course's requirements.";
    }

    return relevantExamples.map(ex => `
Example: "${ex.example}"
Output: ${JSON.stringify(ex.json, null, 2)}
`).join('\n');
}

function needsReparsing(course: CourseCondensedInfo, existing: CourseRequirements): boolean {
    return (
        existing.original_title !== course.title ||
        existing.original_prerequisites !== course.prerequisites ||
        existing.original_corequisites !== course.corequisites ||
        existing.original_notes !== course.notes ||
        existing.schema_version !== 'SFUv1.1'
    );
}

async function loadExistingResults(): Promise<Map<string, CourseRequirements>> {
    const resultsMap = new Map<string, CourseRequirements>();
    const outputPath = path.join(__dirname, 'generated_data', 'parsed_requirements.json');

    try {
        const content = await fs.readFile(outputPath, 'utf-8');
        const results: CourseRequirements[] = JSON.parse(content);

        results.forEach(result => {
            const key = `${result.department} ${result.number}`;
            resultsMap.set(key, result);
        });

        console.log(`Loaded ${results.length} existing results`);
    } catch (error) {
        console.log('No existing results found, starting fresh');
    }

    return resultsMap;
}

async function saveResults(results: CourseRequirements[]): Promise<void> {
    const outputPath = path.join(__dirname, 'generated_data', 'parsed_requirements.json');
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf-8');
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
        number: courseCode,
        reason,
        timestamp: new Date().toISOString()
    };

    // Check if already blacklisted
    const exists = blacklist.find(item =>
        item.department === department && item.number === courseCode
    );

    if (exists) {
        // this should never happen
        console.log(`  ⚠️  Course ${department} ${courseCode} is already blacklisted: ${exists.reason}`);
        return;
    }

    blacklist.push(newEntry);
    await saveBlacklist(blacklist);
    console.log(`  🚫 Added ${department} ${courseCode} to blacklist.`);
}

function isBlacklisted(course: CourseCondensedInfo, blacklist: BlacklistedCourse[]): boolean {
    return blacklist.some(item =>
        item.department === course.department && item.number === course.number
    );
}

// Helper function to save LLM debug information to file
async function saveLLMDebugInfo(courseKey: string, llmResponses: Array<any>): Promise<void> {
    if (llmResponses.length === 0) return;

    const debugDir = path.join(__dirname, 'generated_data', 'llm_debug');

    // Create debug directory if it doesn't exist
    try {
        await fs.mkdir(debugDir, { recursive: true });
    } catch (error) {
        // Directory might already exist, ignore error
    }

    const debugFile = path.join(debugDir, `${courseKey.replace('/', '-')}_debug.json`);

    // Format debug info for saving
    const debugInfo = {
        courseKey,
        timestamp: new Date().toISOString(),
        responses: llmResponses.map(response => ({
            step: response.step,
            attempt: response.attempt,
            success: response.success,
            relevantExamples: response.relevantExamples,
            error: response.error,
            fullPrompt: response.fullPrompt,
            response: response.response
        }))
    };

    try {
        await fs.writeFile(debugFile, JSON.stringify(debugInfo, null, 2), 'utf-8');
        console.log(`💾 Debug info saved to: llm_debug/${courseKey.replace('/', '-')}_debug.json`);
    } catch (error) {
        console.log(`      ⚠️  Failed to save debug info: ${error}`);
    }
}

async function main(): Promise<void> {
    if (!process.env.OPENROUTER_API_KEY) {
        console.error('Error: OPENROUTER_API_KEY not found in environment variables');
        process.exit(1);
    }

    // Load course data
    const vitalDataPath = path.join(__dirname, 'source_data', 'vital_data.json');
    const coursesContent = await fs.readFile(vitalDataPath, 'utf-8');
    const courses: CourseCondensedInfo[] = JSON.parse(coursesContent);

    console.log(`Loaded ${courses.length} courses to process`);

    // Debug: Check for undefined courses
    const undefinedCount = courses.filter((course, index) => !course).length;
    if (undefinedCount > 0) {
        console.error(`Warning: Found ${undefinedCount} undefined courses in the array`);
        console.error('First few courses:', courses.slice(0, 5));
    }

    // Load existing results
    const existingResults = await loadExistingResults();
    const resultsList: CourseRequirements[] = Array.from(existingResults.values());

    // Load blacklist
    const blacklist = await loadBlacklist();
    console.log(`Loaded ${blacklist.length} blacklisted courses`);

    // Process each course
    for (let i = 0; i < courses.length; i++) {

        const course = courses[i];
        assert(course, `Course at index ${i} is undefined`);

        const courseKey = `${course.department} ${course.number}`;
        console.log(`[${i + 1}/${courses.length}] ${courseKey}`);

        // Skip if blacklisted
        if (isBlacklisted(course, blacklist)) {
            console.log(`⏭️  Skipping (blacklisted).`);
            continue;
        }

        // Skip courses with no requirements
        if (!course.prerequisites && !course.corequisites && !course.notes) {
            console.log(`⏭️  Skipping (no requirements).`);
            continue;
        }

        // Check if already processed and up to date
        const existing = existingResults.get(courseKey);

        if (existing) {
            // Check if anything changed that would require reparsing
            const shouldReparse = existing.original_title !== course.title ||
                existing.original_prerequisites !== course.prerequisites ||
                existing.original_corequisites !== course.corequisites ||
                existing.original_notes !== course.notes ||
                existing.schema_version !== 'SFUv1.1';

            if (!shouldReparse) {
                // console.log(`⏭️  Skipping (already up to date).`);
                continue;
            }

            console.log(`🔄 Reparsing (data changed).`);
        } else {
            console.log(`🆕 Parsing this course for the first time.`);
        }

        if (course.prerequisites) {
            console.log(`   📚 Prerequisites: "${course.prerequisites}"`);
        } if (course.corequisites) {
            console.log(`   🔗 Corequisites: "${course.corequisites}"`);
        } if (course.notes) {
            console.log(`   📝 Notes: "${course.notes}"`);
        }

        // Process the course
        const result = await processCourse(course);

        if (!result.success || !result.data) {
            console.log(`❌ Parsing failed: ${result.error}`);

        } else {
            // Convert to CourseRequirements and save
            const courseRequirements: CourseRequirements = {
                ...result.data,
                original_title: course.title,
                original_prerequisites: course.prerequisites,
                original_corequisites: course.corequisites,
                original_notes: course.notes,
                timestamp: new Date().toISOString()
            };

            // Update or add to results
            if (existing) {
                const index = resultsList.findIndex(r => r.department === course.department && r.number === course.number);
                if (index >= 0) {
                    resultsList[index] = courseRequirements;
                } else {
                    resultsList.push(courseRequirements);
                }
            } else {
                resultsList.push(courseRequirements);
            }
            existingResults.set(courseKey, courseRequirements);

            // Save immediately
            await saveResults(resultsList);

            console.log(`✅ Successfully parsed and saved`);

        }
    }




    console.log(`\nAll done.`);
}

// Export functions for testing
export {
    parseRequirements,
    checkForAmbiguityInCourseDescription as checkForAmbiguity,
    validateWithLLM,
    processCourse,
    needsReparsing,
    loadBlacklist,
    addToBlacklist,
    isBlacklisted
};

// Run if executed directly
if (import.meta.main) {
    main().catch(console.error);
}