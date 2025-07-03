# SFU-prerequisites-to-data

Success Progress:  [█████████████████████████████████░░░░░░░░░░░░░░░░░] 66.5%

A project to convert SFU course prerequisites from text to data.

initialize data with
`bun run initialize`

then run with
`bun run parse`

create csv's with links and nodes using
`bun run export`

You will need an `OPENROUTER_API_KEY` in a `.env` file.

Parsing one course costs ~0.1 cents on average (estimate)


### Currently Known Issues

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