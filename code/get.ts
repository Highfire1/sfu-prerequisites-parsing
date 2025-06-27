import { promises as fs } from 'fs';
import path from 'path';

const OUTLINES_URL = 'https://api.sfucourses.com/v1/rest/outlines/all';
const OUTLINES_PATH = path.join(__dirname, 'data', 'outlines_all.json');
const VITAL_DATA_PATH = path.join(__dirname, 'data', 'vital_data.json');

async function fetchAndSaveOutlines() {
    const res = await fetch(OUTLINES_URL);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
    const json = await res.json();
    await fs.mkdir(path.dirname(OUTLINES_PATH), { recursive: true });
    await fs.writeFile(OUTLINES_PATH, JSON.stringify(json, null, 2), 'utf-8');
    return json;
}

type CourseCondensedInfo = {
    dept: string;
    number: string; // deceptive naming, see FAN X99
    title: string;
    notes: string;
    prerequisites: string;
    corequisites: string;
};

async function parseVitalData(json: any) {
    const outlines: CourseCondensedInfo[] = json.data.map((item: any) => ({
        dept: item.dept,
        number: item.number,
        title: item.title,
        notes: item.notes,
        prerequisites: item.prerequisites,
        corequisites: item.corequisites,
    }));
    await fs.writeFile(VITAL_DATA_PATH, JSON.stringify(outlines, null, 2), 'utf-8');
}

async function main() {
    const json = await fetchAndSaveOutlines();
    await parseVitalData(json);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});