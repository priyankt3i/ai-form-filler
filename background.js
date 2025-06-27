chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generateFormData') {
        (async () => {
            try {
                const generatedData = await generateDataWithAI(request.fields, request.attempt);
                sendResponse({ status: 'success', data: generatedData });
            } catch (error) {
                console.error("AI Generation Error:", error);
                sendResponse({ status: 'error', message: error.message });
            }
        })();
        return true; 
    }
});

async function generateDataWithAI(fields, attempt = 1) {
    const storageResult = await chrome.storage.local.get(['apiKey']);
    const apiKey = storageResult.apiKey;

    if (!apiKey) {
        throw new Error("API Key not found. Please set it in the extension popup.");
    }

    console.log(`Sending fields to AI (Attempt: ${attempt}):`, fields);
    
    // **IMPROVED PROMPT:** This prompt is much more prescriptive about handling specific field types.
    const prompt = `You are an expert data generation assistant for web form testing.
    Your task is to generate realistic, contextually correct data for a list of form fields.
    Pay EXTREME attention to the field's 'label', 'name', 'placeholder', and especially 'options' attributes.
    
    **CRITICAL RULES:**
    1.  **Selection Fields**: If a field has an 'options' array, you MUST return one of those exact string values for that field. Do not invent a new value. If the options are like ["Select", "Married", "Single"], DO NOT choose "Select".
    2.  **Date Fields**: For any field labeled 'Birth date', 'start date', etc., generate a realistic date in MM/DD/YYYY format. For birth dates, the person should be between 25 and 65 years old. For future dates, pick a date within the next month.
    3.  **Address Fields**: Ensure City, State (use 2-letter abbreviation), and Zip Code are a valid, real-world combination.
    4.  **Standard Fields**: Generate plausible First Name, Last Name, Email, Phone Number, etc., in standard formats.
    5.  **Completeness**: You MUST provide a value for EVERY field listed. Do not skip any.
    
    Here are the fields to fill:
    ${JSON.stringify(fields, null, 2)}

    Generate a JSON object with a single key "formData", which is an array of objects, each with a "name" and "value" for every field listed above.
    `;
    
    const schema = {
        type: "OBJECT",
        properties: { "formData": { type: "ARRAY", items: { type: "OBJECT", properties: { "name": { "type": "STRING" }, "value": { "type": "STRING" } }, "required": ["name", "value"] } } },
        required: ["formData"]
    };

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema }
    };
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        if (response.status === 403) throw new Error("API request failed (403). Is your API key correct?");
        throw new Error(`API request failed with status ${response.status}`);
    }

    const result = await response.json();
    console.log("AI API Response:", result);

    if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
        try {
            const jsonText = result.candidates[0].content.parts[0].text;
            const parsedJson = JSON.parse(jsonText);
            if (!parsedJson.formData || parsedJson.formData.length === 0) {
                 throw new Error("AI returned empty form data.");
            }
            return parsedJson.formData;
        } catch (e) {
            console.error("Failed to parse AI response JSON:", e);
            throw new Error("Invalid JSON response from AI.");
        }
    } else {
        throw new Error("AI did not return valid data content.");
    }
}
