document.addEventListener('DOMContentLoaded', () => {
    // Get references to all UI elements
    const fillFormBtn = document.getElementById('fill-form-btn');
    const statusDiv = document.getElementById('status');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyStatusDiv = document.getElementById('key-status');
    
    // New log elements
    const aiRequestLog = document.getElementById('ai-request-log');
    const aiResponseLog = document.getElementById('ai-response-log');
    const clearLogsBtn = document.getElementById('clear-logs-btn');


    // Function to load logs from storage
    const loadLogs = () => {
        chrome.storage.local.get(['aiRequestLog', 'aiResponseLog'], (result) => {
            if (result.aiRequestLog) {
                aiRequestLog.value = result.aiRequestLog;
            }
            if (result.aiResponseLog) {
                aiResponseLog.value = result.aiResponseLog;
            }
        });
    };

    // On popup load, get API key and load any existing logs
    chrome.storage.local.get(['apiKey'], (result) => {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
    });
    loadLogs();


    // Add click listener for the "Save Key" button
    saveKeyBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.local.set({ apiKey: apiKey }, () => {
                keyStatusDiv.textContent = 'API Key saved successfully!';
                setTimeout(() => { keyStatusDiv.textContent = ''; }, 3000);
            });
        }
    });
    
    // Add click listener for the "Clear Logs" button
    clearLogsBtn.addEventListener('click', () => {
        chrome.storage.local.remove(['aiRequestLog', 'aiResponseLog'], () => {
            aiRequestLog.value = '';
            aiResponseLog.value = '';
            console.log("AI logs cleared.");
        });
    });


    // Add a click event listener to the main "Fill Form" button
    fillFormBtn.addEventListener('click', async () => {
        setLoadingState(true);
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.id) {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
                
                const response = await chrome.tabs.sendMessage(tab.id, { action: "fillForm" });

                if (response) {
                    if (response.status === "success") {
                        statusDiv.textContent = response.message || `Successfully filled ${response.fieldsFilled} fields.`;
                    } else if (response.status === "error") {
                        statusDiv.textContent = `Error: ${response.message}`;
                    }
                }
                // After the action, reload the logs to show the latest.
                loadLogs(); 
            } else {
                statusDiv.textContent = 'Could not find active tab.';
            }
        } catch (error) {
            console.error("Form Filler Error:", error);
            statusDiv.textContent = 'An unexpected error occurred.';
        } finally {
            setLoadingState(false);
        }
    });

    function setLoadingState(isLoading) {
        fillFormBtn.disabled = isLoading;
        statusDiv.textContent = isLoading ? 'Analyzing form with AI...' : '';
    }
});
