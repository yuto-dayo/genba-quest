const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

async function main() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    try {
        // Fetch list of all available models
        // In @google/generative-ai v0.x, we need to fetch via REST because listModels might be missing or different
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        
        console.log("=== Available Models ===");
        if (data.models) {
            data.models.forEach(m => {
                if(m.name.includes('gemini')) {
                   console.log(`- ${m.name} (Methods: ${m.supportedGenerationMethods.join(', ')})`);
                }
            });
        } else {
            console.log(data);
        }
    } catch(err) {
        console.error(err);
    }
}
main();
