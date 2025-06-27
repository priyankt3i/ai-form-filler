document.addEventListener('DOMContentLoaded', () => {
    // Get references to all UI elements
    const fillFormBtn = document.getElementById('fill-form-btn');
    const statusDiv = document.getElementById('status');
    const buttonIcon = fillFormBtn.querySelector('svg');
    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const keyStatusDiv = document.getElementById('key-status');

    // On popup load, try to get the stored API key and show it in the input
    chrome.storage.local.get(['apiKey'], (result) => {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
    });

    // Add click listener for the "Save Key" button
    saveKeyBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            chrome.storage.local.set({ apiKey: apiKey }, () => {
                keyStatusDiv.textContent = 'API Key saved successfully!';
                setTimeout(() => { keyStatusDiv.textContent = ''; }, 3000);
            });
        } else {
            keyStatusDiv.style.color = '#ef4444'; // Red color for error
            keyStatusDiv.textContent = 'Please enter an API key.';
            setTimeout(() => {
                keyStatusDiv.textContent = '';
                keyStatusDiv.style.color = '#16a34a'; // Reset to green
            }, 3000);
        }
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
                        statusDiv.textContent = `Successfully filled ${response.fieldsFilled} fields.`;
                    } else if (response.status === "error") {
                        statusDiv.textContent = `Error: ${response.message}`;
                    }
                } else {
                     statusDiv.textContent = "No response from page. Is it a valid form page?";
                }
            } else {
                statusDiv.textContent = 'Could not find active tab.';
            }
        } catch (error) {
            console.error("Form Filler Error:", error);
            if (error.message.includes("Cannot access a chrome://")) {
                statusDiv.textContent = "Cannot run on Chrome settings pages.";
            } else {
                 statusDiv.textContent = 'An unexpected error occurred.';
            }
        } finally {
            setLoadingState(false);
        }
    });

    /**
     * Toggles the loading state of the UI.
     * @param {boolean} isLoading - Whether to show the loading state.
     */
    function setLoadingState(isLoading) {
        if (isLoading) {
            fillFormBtn.disabled = true;
            buttonIcon.classList.add('animate-spin-slow');
            statusDiv.textContent = 'Analyzing form with AI...';
        } else {
            fillFormBtn.disabled = false;
            buttonIcon.classList.remove('animate-spin-slow');
        }
    }
});
