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
    
    const today = new Date();
    const todayDate = (today.getMonth() + 1).toString().padStart(2, '0') + '/' + today.getDate().toString().padStart(2, '0') + '/' + today.getFullYear();

    // **UPDATED PROMPT**
    const prompt = `You are an expert data generation assistant for web form testing.
    Your task is to generate realistic, contextually correct data for a list of form fields.
    Pay EXTREME attention to the field's 'label', 'name', 'placeholder', and especially 'options available to select' attributes.
    
    **CRITICAL RULES:**
    1.  **Selection Fields**: If a field has an "options available to select" property, you MUST return one of the values from that semi-colon delimited string. Do not invent a new value.
    2.  **Date Fields**: For any field labeled 'Birth date', 'start date', etc., generate a realistic date in MM/DD/YYYY format. For birth dates, the person should be between 25 and 65 years old.
    3.  **Address Fields**: Ensure City, State (use 2-letter abbreviation), and Zip Code are a valid, real-world combination.
    4.  **Standard Fields**: Generate plausible First Name, Last Name, Email, Phone Number, etc., in standard formats.
    5.  **Completeness**: You MUST provide a value for EVERY field listed. Do not skip any.
    6.  **Fictional Data**: All data should be realistic and no fictional data should be used For Example Do Not Use phone number like starting with 555, or placed called Naria, or names like John Doe, Jane Doe etc..
    7.  **Consider Logically Entry**: 
        - If a field is labeled 'Age', generate a number between 18 and 100. 
        - If it is 'Salary', generate a realistic salary amount (e.g., 50000, 75000, etc.). 
        - If a Field is labeled "Policy start date" obviously it cannot be in past, so select a date in near future from ${todayDate}. Any such date should be a future date unless it's a Date of Birth field or something that need a date in Past.

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
    
    const result = await response.json();

    await chrome.storage.local.set({
        aiRequestLog: prompt,
        aiResponseLog: JSON.stringify(result, null, 2)
    });

    if (!response.ok) {
        if (response.status === 403) throw new Error("API request failed (403). Is your API key correct?");
        throw new Error(`API request failed with status ${response.status}`);
    }

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
