/*
This file represents the canonical examples of how course requirements should be formatted.
*/


import type { CreditConflict, ParsedCourseRequirements, RequirementNode } from './types.js';

interface ExampleEntry {
    keyword: string;
    example: string;
    json: ExampleCourseRequirements;
}

interface ExampleCourseRequirements {
    prerequisite?: RequirementNode;
    corequisite?: RequirementNode;
    recommended_prerequisite?: RequirementNode;
    recommended_corequisite?: RequirementNode;
    credit_conflicts?: CreditConflict[];
}


const examples: ExampleEntry[] = [


    // ONE OF
    {
        keyword: "any one of",
        example: "any one of ARCH 285, GEOG 251, or PSYC 210",
        json: {
            prerequisite: {
                type: "group",
                logic: "ONE_OF",
                children: [
                    { type: "course", department: "ARCH", number: "285" },
                    { type: "course", department: "GEOG", number: "251" },
                    { type: "course", department: "PSYC", number: "210" }
                ]
            }
        }
    },
    // ALL OF
    {
        keyword: ",",
        example: "STAT 330, ACMA 231.",
        json: {
            corequisite: {
                type: "group",
                logic: "ALL_OF",
                children: [
                    { type: "course", department: "STAT", number: "330" },
                    { type: "course", department: "ACMA", number: "231" }
                ]
            }
        }
    },

    // TWO OF
    {
        keyword: "two of",
        example: "two of BPK 201, 205 and 207.",
        json: {
            prerequisite: {
                type: "group",
                logic: "TWO_OF",
                children: [
                    { type: "course", department: "BPK", number: "201" },
                    { type: "course", department: "BPK", number: "205" },
                    { type: "course", department: "BPK", number: "207" }
                ]
            }
        }
    },

    // minGrade
    {
        keyword: "minimum grade",
        example: "CMPT 383 with a minimum grade of C-.",
        json: {
            "prerequisite": {
                "type": "course",
                "department": "CMPT",
                "number": "383",
                "minGrade": "C-"
            }
        }
    },

    // ONE OF + minGrade
    {
        keyword: "grade of at least",
        example: "MATH 155 or MATH 158, with a grade of at least B.",
        json: {
            prerequisite: {
                type: "group",
                logic: "ONE_OF",
                children: [
                    { type: "course", department: "MATH", number: "155", minGrade: "B" },
                    { type: "course", department: "MATH", number: "158", minGrade: "B" }
                ]
            }
        }
    },

    // {
    //     keyword: "or",
    //     example: "HIST 277 or by permission of the instructor.",
    //     json: {
    //         prerequisite: {
    //             type: "group",
    //             logic: "ONE_OF",
    //             children: [
    //                 { type: "course", department: "HIST", number: "277" },
    //                 { type: "permission", note: "by permission of the instructor" }
    //             ]
    //         }
    //     }
    // },

    {
        keyword: "corequisite",
        example: "Prerequisite: BPK 491 (minimum grade of B). Corequisite: BPK 499. (NOTE: if you see a corequisite in the prequisite field, this is ok, treat it as a corequisite)",
        json: {
            prerequisite: {
                type: "course",
                department: "BPK",
                number: "491",
                minGrade: "B"
            },
            corequisite: {
                type: "course",
                department: "BPK",
                number: "499"
            }
        }
    },


    // corequisite
    {
        keyword: "corequisite",
        example: "Corequisite: MATH 150, 151, 154 or 157.",
        json: {
            "corequisite": {
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
    },

    {
        keyword: "minimum grade",
        example: "ACMA 301 (or 320), with a minimum grade of C.",
        json: {
            prerequisite: {
                type: "group",
                logic: "ONE_OF",
                children: [
                    { type: "course", department: "ACMA", number: "301", minGrade: "C" },
                    { type: "course", department: "ACMA", number: "320", minGrade: "C" }
                ]
            }
        }
    },

    {
        keyword: "and",
        example: "MATH 150 and MATH 151.",
        json: {
            "prerequisite": {
                "type": "group",
                "logic": "ALL_OF",
                "children": [
                    { "type": "course", "department": "MATH", "number": "150" },
                    { "type": "course", "department": "MATH", "number": "151" }
                ]
            }
        }
    },

    {
        keyword: "units",
        example: "60 units of university coursework.",
        json: {
            "prerequisite": {
                "type": "creditCount",
                "credits": 60
            }
        }
    },

    {
        keyword: "credits",
        example: "A minimum of 80 credits.",
        json: {
            prerequisite: {
                type: "creditCount",
                credits: 80,
            }
        }
    },

    {
        keyword: "credit hours",
        example: "45 credit hours.",
        json: {
            prerequisite: {
                type: "creditCount",
                credits: 45
            }
        }
    },



    {
        keyword: "level",
        example: "Two courses from MATH 100-level.",
        json: {
            "prerequisite": {
                "type": "courseCount",
                "count": 2,
                "department": "MATH",
                "level": "1XX"
            }
        }
    },

    {
        keyword: "level",
        example: "any 100-level MATH course with a minimum grade of C.",
        json: {
            prerequisite: {
                type: "courseCount",
                count: 1,
                department: "MATH",
                level: "1XX",
                minGrade: "C"
            }
        }
    },

    {
        keyword: "lower division",
        example: "One lower division CMPT course.",
        json: {
            prerequisite: {
                type: "courseCount",
                count: 1,
                department: "CMPT",
                level: "LD"
            }
        }
    },

    {
        keyword: "upper division",
        example: "One upper division CMPT course.",
        json: {
            prerequisite: {
                type: "courseCount",
                count: 1,
                department: "CMPT",
                level: "UD"
            }
        }
    },

    {
        keyword: "CGPA",
        example: "CGPA of 2.50.",
        json: {
            "prerequisite": {
                "type": "CGPA",
                "minCGPA": 2.5
            }
        }
    },

    {
        keyword: "UDGPA",
        example: "A minimum upper division GPA of 2.00.",
        json: {
            "prerequisite": {
                "type": "UDGPA",
                "minUDGPA": 2.0
            }
        }
    },

    {
        keyword: "level",
        example: "HSCI 200-level course.",
        json: {
            "prerequisite": {
                "type": "courseCount",
                "count": 1,
                "department": "HSCI",
                "level": "2XX"
            }
        }
    },

    {
        keyword: "upper division",
        example: "15 upper division PHIL units.",
        json: {
            "prerequisite": {
                "type": "creditCount",
                "credits": 15,
                "department": "PHIL",
                "level": "UD"
            }
        }
    },

    {
        keyword: "concurrent",
        example: "MATH 150 (may be taken concurrently).",
        json: {
            "prerequisite": {
                "type": "course",
                "department": "MATH",
                "number": "150",
                "canBeTakenConcurrently": "true"
            }
        }
    },

    {
        keyword: "equivalent",
        example: "BC Mathematics 12 (or equivalent).",
        json: {
            "prerequisite": {
                "type": "HSCourse",
                "course": "BC Mathematics 12",
                "orEquivalent": "true"
            }
        }
    },

    {
        keyword: "permission",
        example: "Students must apply and receive permission from the co-op coordinator.",
        json: {
            "prerequisite": {
                "type": "permission",
                "note": "Students must apply and receive permission from the co-op coordinator"
            }
        }
    },

    {
        keyword: "approval",
        example: "Enrollment requires approval of the department.",
        json: {
            prerequisite: {
                type: "permission",
                note: "Enrollment requires approval of the department."
            }
        }
    },

    {
        keyword: "admission",
        example: "Admission to Faculty of Science.",
        json: {
            "prerequisite": {
                "type": "program",
                "program": "Admission to Faculty of Science"
            }
        }
    },

    {
        keyword: "acceptance",
        example: "Acceptance into the environmental toxicology program.",
        json: {
            prerequisite: {
                type: "program",
                program: "Acceptance into the environmental toxicology program"
            }
        }
    },

    {
        keyword: "enrollment",
        example: "Enrollment in the MA or Certificate in HRM.",
        json: {
            prerequisite: {
                type: "group",
                logic: "ONE_OF",
                children: [
                    {
                        type: "program",
                        program: "MA in HRM"
                    },
                    {
                        type: "program",
                        program: "Certificate in HRM"
                    }
                ]
            }
        }
    },

    {
        keyword: "further credit",
        example: `Students with credit for HS 312 cannot take this course for further credit.`,
        json: {            
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "HS",
                    number: "312"
                }
            ]
        }
    },

    {
        keyword: "under the title",
        example: `Students with credit for ARCH 321 under the title "Select Regions in World Archaeology I: Greece" may not take this course for further credit.`,
        json: {
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "ARCH",
                    number: "321",
                    title: 'Select Regions in World Archaeology I: Greece'
                }
            ]
        }
    },

    {
        keyword: "subject of the course",
        example: "Students who have taken BUS 493 when the subject of the course was Sports and Entertainment Marketing may not take BUS 446 for further credit.",
        json: {
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "BUS",
                    number: "493",
                    title: "Sports and Entertainment Marketing"
                }
            ]
        }
    },

    {
        keyword: "under the topic",
        example: `Students with credit for HIST 307 under the topic "Glory to Debt" may not take this course for further credit.`,
        json: {
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "HIST",
                    number: "307",
                    title: "Glory to Debt"
                }
            ]
        }
    },

    {
        keyword: "may not enroll",
        example: "Students who have taken ARCH 201 may not enroll in ARCH 101.",
        json: {
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "ARCH",
                    number: "201"
                }
            ]
        }
    },

    {
        keyword: "higher level",
        example: "Students who have taken BISC 101 or higher level BISC courses first may not then take this course for further credit.",
        json: {
            credit_conflicts: [
                {
                    type: "conflict_course",
                    department: "BISC",
                    number: "101"
                },
                {
                    type: "conflict_other",
                    note: "Students who have taken higher level BISC courses first may not then take this course for further credit."}
            ]
        }
    },


    {
        keyword: "to be announced",
        example: "To be announced.",
        json: {
            prerequisite: {
                type: "other",
                note: "To be announced."
            }
        }
    },

    {
        keyword: "to be determined",
        example: "To be determined by the instructor subject to approval by the department chair.",
        json: {
            prerequisite: {
                type: "other",
                note: "To be determined by the instructor subject to approval by the department chair"
            }
        }
    },

    {
        keyword: "other prerequisites may be required",
        example: "Other prerequisites may be required, but will vary according to topic.",
        json: {
            prerequisite: {
                type: "other",
                note: "Other prerequisites may be required, but will vary according to topic."
            }
        }
    },

    {
        keyword: "as stated",
        example: "As stated by department at time of offering.",
        json: {
            prerequisite: {
                type: "other",
                note: "As stated by department at time of offering."
            }
        }
    },

    {
        keyword: "recommended",
        example: "ARCH 373. Recommended: ARCH 282",
        json: {
            prerequisite: {
                type: "course",
                department: "ARCH",
                number: "373"
            },
            recommended_prerequisite: {
                type: "course",
                department: "ARCH",
                number: "282"
            }
        }
    },
    

    {
        keyword: "units",
        example: "Six units in GSWS or CA.",
        json: {
            prerequisite: {
                type: "creditCount",
                credits: 6,
                department: ["GSWS", "CA"]
            }
        }
    },

    // reccomended corequisite
    {
        keyword: "normally taken concurrently",
        example: "Normally taken concurrently with ARCH 434 and 435.",
        json: {
            recommended_corequisite: {
                type: "group",
                logic: "ALL_OF",
                children: [
                    { type: "course", department: "ARCH", number: "434" },
                    { type: "course", department: "ARCH", number: "435" }
                ]
            }
        }
    },

    // some crosslisted courses have this but others don't
    // oh well, we try our best
    // {
    //     keyword: "equivalent courses",
    //     example: "Equivalent Courses: MBA603",
    //     json: {
    //         credit_conflicts: [
    //             {
    //                 type: "conflict_course",
    //                 department: "MBA",
    //                 number: "603"
    //             }
    //         ]
    //     }
    // },

    // only one course asks for grade 11 courses
    // {
    //     keyword: "grade 11",
    //     example: "Grade 11 Biology, Chemistry and Physics",
    //     json: {
    //         prerequisite: {
    //             type: "group",
    //             logic: "ALL_OF",
    //             children: [
    //                 { type: "HSCourse", course: "Grade 11 Biology" },
    //                 { type: "HSCourse", course: "Grade 11 Chemistry" },
    //                 { type: "HSCourse", course: "Grade 11 Physics" }
    //             ]
    //         }
    //     }
    // }

    // {
    //     keyword: "grade 12",
    //     example: "Grade 12 Anatomy and Physiology",
    //     json: {
    //         prerequisite: {
    //             type: "HSCourse",
    //             course: "Grade 12 Anatomy and Physiology"
    //         }
    //     }
    // },

    {
        keyword: "grade 12",
        example: "One of Grade 12 Anatomy and Physiology, Biology, Chemistry or Physics with a grade of B or better",
        json: {
            prerequisite: {
                type: "group",
                logic: "ONE_OF",
                children: [
                    { type: "HSCourse", course: "Grade 12 Anatomy and Physiology", minGrade: "B" },
                    { type: "HSCourse", course: "Grade 12 Biology", minGrade: "B" },
                    { type: "HSCourse", course: "Grade 12 Chemistry", minGrade: "B" },
                    { type: "HSCourse", course: "Grade 12 Physics", minGrade: "B" }
                ]
            }
        }
    },

    {
        keyword: "fee",
        example: "A course materials fee is required.",
        json: {
            prerequisite: {
                type: "other",
                note: "A course materials fee is required."
            }
        }
    },

    {
        keyword: "division",
        example: "one 100-division English course",
        json: {
            prerequisite: {
                type: "courseCount",
                count: 1,
                department: "English",
                level: "1XX"
            }
        }
    },

    {
        keyword: ", including",
        example: "45 units, including six units of lower division history",
        json: {
            "prerequisite": {
            "type": "group",
            "logic": "ALL_OF",
            "children": [
                {
                    "type": "creditCount",
                    "credits": 45
                },
                {
                    "type": "creditCount",
                    "credits": 6,
                    "department": "history",
                    "level": "LD"
                }
            ]
            }
        }
    },

    {
        keyword: "courses in ",
        example: "It is strongly recommended that students have taken prior courses in metaphysics and epistemology.",
        json: {
            recommended_prerequisite: {
                type: "other",
                note: "It is strongly recommended that students have taken prior courses in metaphysics and epistemology."
            }
        }
    },

    {
        keyword: "practicum",
        example: "Job Practicum IV from another department.",
        json: {
            prerequisite: {
                type: "other",
                note: "Job Practicum IV from another department."
            }
        }
    },

    {
        keyword: "practicum",
        example: "Completion of HSCI 351 Co-op Practicum II.",
        json: {
            prerequisite: {
                type: "course",
                department: "HSCI",
                number: "351",
            }
        }
    }





];

export { examples, type ExampleEntry };