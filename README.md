# SFU-prerequisites-to-data

A project to convert SFU course prerequisites from text to data.

Work in progress.

initialize data with
`bun run fetch-data`

then run with
`bun run parse`

You will need an `OPENROUTER_API_KEY` in a `.env` file.

Parsing one course requires about 3 to 15 cents depending on its complexity


### Currently Known Issues

the credit conflicts field is missing information. 
- Some conflicts are order based (e.g. BISC 205 is a duplicate credit, but only if BISC 305/306 were taken first) 
- `"Students with credit for ARCH 321 under the title "Select Regions in World Archaeology I: Greece" may not take this course for further credit."` where the conflict is only if the course is offered with that specific detail is not captured

Some courses are not returned by the API for unknown reasons
- ARCH 344 mentions ARCH 333, but it is not in the list of courses from the API

At least one prerequisite text from the API is different than the SFU website
- ie. BISC 305 where API says "(BISC 205 or BPK 205) and MBB 231, both with a minimum grade of C-."
- website says "BISC 205 (or BPK 205) and MBB 231 with a grade of C- or better."
They are equivalent in this case but it is questionable
and possibly in some cases one of the two might be more clear/easier to parse?

### Changes to be made

Workflow could be faster
- probably best to generate 100 courses at a time in advance, and then you can go through them without waiting for the llm to generate tokens
- especially because there are 2653 courses right now and that will actually take many many hours
- either that or find a faster llm provider

Need to be able to reprompt the llm to make a specific change

