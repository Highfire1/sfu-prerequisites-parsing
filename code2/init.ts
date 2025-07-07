import { promises as fs } from 'fs';
import path from 'path';

async function fetchOutlines() {
    try {
        console.log('🔄 Fetching SFU course outlines...');
        
        // Fetch data from the API
        const response = await fetch('https://api.sfucourses.com/v1/rest/outlines');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Create data directory if it doesn't exist
        const dataDir = path.join(__dirname, 'data');
        await fs.mkdir(dataDir, { recursive: true });
        
        // Save to file
        const outputPath = path.join(dataDir, 'outlines.json');
        await fs.writeFile(outputPath, JSON.stringify(data, null, 2), 'utf-8');
        
        console.log(`✅ Successfully saved ${Array.isArray(data) ? data.length : 'data'} outlines to ${outputPath}`);
        
    } catch (error) {
        console.error('❌ Error fetching outlines:', error);
        process.exit(1);
    }
}

// Run the fetch function
fetchOutlines();
