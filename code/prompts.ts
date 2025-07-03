import * as fs from 'fs/promises';
import path from 'path';

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

Type definitions follow:
${types}
`;
