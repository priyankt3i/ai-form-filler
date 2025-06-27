console.log("AI Form Filler: content.js script has been injected and is running.");

// Main listener for commands from the popup.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fillForm") {
        console.log("Content script received fillForm command.");
        // We wrap the entire process in an async function to handle retries.
        runFormFillProcess(sendResponse, 3); // Start the process with a max of 3 retries
        return true; // Indicate that the response will be sent asynchronously.
    }
});

/**
 * The main logic loop for filling, submitting, and checking for errors.
 * @param {Function} sendResponse - The function to call to send a result back to the popup.
 * @param {number} maxAttempts - The maximum number of times to try filling the form.
 */
async function runFormFillProcess(sendResponse, maxAttempts) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // 1. Scrape the form to identify all input fields.
            const formFields = scrapeFormFields();
            if (formFields.length === 0) {
                throw new Error("No fillable form fields found on the page.");
            }

            // 2. Send the scraped fields to the background script to get AI data.
            console.log(`Attempt ${attempt}: Requesting data from AI.`);
            // DEBUG: Log the request being sent to the background script.
            console.log(`DEBUG: Sending AI request with these fields:`, JSON.parse(JSON.stringify(formFields)));
            
            const aiResponse = await chrome.runtime.sendMessage({
                action: 'generateFormData',
                fields: formFields,
                attempt: attempt // Pass attempt number for logging
            });
            
            // DEBUG: Log the response received from the background script.
            console.log(`DEBUG: Received AI response:`, JSON.parse(JSON.stringify(aiResponse)));


            if (aiResponse.status === 'error') throw new Error(aiResponse.message);

            // 3. Fill the form with the data received from the AI.
            const filledCount = await fillFormWithData(aiResponse.data);

            // 4. Find and click the submit button.
            const submitButton = findAndClickSubmitButton();
            if (!submitButton) {
                // If there's no submit button, we can't verify, so we assume success.
                console.log("No submit button found. Assuming success.");
                sendResponse({ status: "success", fieldsFilled: filledCount, message: "Filled fields, no submit button found." });
                return;
            }

            // 5. Wait and observe the page for error messages.
            const errorDetected = await observeForErrors(5000); // Observe for 5 seconds

            if (errorDetected) {
                console.warn(`Attempt ${attempt} failed. Error detected on page: "${errorDetected}"`);
                if (attempt === maxAttempts) {
                    throw new Error(`Failed after ${maxAttempts} attempts. Last error: ${errorDetected}`);
                }
                // If errors are found, the loop will continue to the next attempt.
            } else {
                // 6. If no errors, we succeeded.
                console.log(`Attempt ${attempt} successful. No errors detected after submission.`);
                sendResponse({ status: "success", fieldsFilled: filledCount, message: `Form submitted successfully after ${attempt} attempt(s).` });
                return; // Exit the loop and function on success.
            }

        } catch (error) {
            console.error(`Error during form processing (Attempt ${attempt}):`, error);
            if (attempt === maxAttempts) {
                sendResponse({ status: "error", message: error.message });
                return; // Exit after the last failed attempt.
            }
        }
    }
}


/**
 * Watches the DOM for a period of time to see if any error messages appear.
 * @param {number} timeout - How long to watch for errors, in milliseconds.
 * @returns {Promise<string|null>} A promise that resolves with the error text if found, or null.
 */
function observeForErrors(timeout) {
    return new Promise((resolve) => {
        const errorKeywords = ['error', 'invalid', 'required', 'enter a valid', 'at least', 'incorrect', 'please check', 'complete all'];
        
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for(const node of mutation.addedNodes){
                        if(node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE){
                            const text = (node.textContent || "").toLowerCase().trim();
                            if(text && errorKeywords.some(keyword => text.includes(keyword))){
                                observer.disconnect();
                                clearTimeout(timer);
                                resolve(node.textContent.trim());
                                return;
                            }
                        }
                    }
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const timer = setTimeout(() => {
            observer.disconnect();
            resolve(null); // No errors detected within the timeout
        }, timeout);
    });
}

/**
 * Finds and clicks a form's submit button.
 * @returns {HTMLElement|null} The button that was clicked, or null.
 */
function findAndClickSubmitButton() {
    const selectors = [
        'button[type="submit"]',
        'button:not([type])', // Many forms use buttons without a type
        'input[type="submit"]',
        '[role="button"]'
    ];
    const textKeywords = ['continue', 'submit', 'next', 'save', 'update', 'go', 'agree'];

    for (const selector of selectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
            const buttonText = (button.textContent || button.value || '').trim().toLowerCase();
            if (textKeywords.some(keyword => buttonText.includes(keyword))) {
                 console.log("Found and clicked submit button:", button);
                 button.click();
                 return button;
            }
        }
    }
    return null;
}

/**
 * Scans the document and extracts details using stable identifiers, including select options.
 * @returns {Array<Object>} An array of objects, each representing a form field.
 */
function scrapeFormFields() {
    const fields = [];
    const elements = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea');
    elements.forEach(el => {
        if (!el.offsetParent) return; // Skip hidden elements

        let identifier = el.getAttribute('formcontrolname') || el.name || el.id;

        if (!identifier) {
            console.warn("Skipping field because it has no formcontrolname, name, or id attribute:", el);
            return;
        }

        let label = findLabelForElement(el);

        let fieldInfo = {
            name: identifier,
            type: el.type || el.tagName.toLowerCase(),
            placeholder: el.placeholder || '',
            label: label || identifier
        };

        if (el.tagName.toLowerCase() === 'select') {
            // **CRITICAL CHANGE**: Extract all options from the dropdown to guide the AI.
            fieldInfo.options = [...el.options].map(opt => opt.text.trim()).filter(Boolean);
            fields.push(fieldInfo);
        } else if (el.type === 'radio') {
            const existingRadio = fields.find(f => f.name === identifier && f.type === 'radio');
            if (existingRadio) {
                if(label) existingRadio.options.push(label);
            } else {
                 fieldInfo.options = label ? [label] : [];
                 fields.push(fieldInfo);
            }
        } else {
             fields.push(fieldInfo);
        }
    });
    return fields;
}

/**
 * Tries to find the text label associated with an element, but does not use placeholder text.
 * @param {HTMLElement} el - The form element.
 * @returns {string|null} The text of the label, or null if not found.
 */
function findLabelForElement(el) {
    if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return label.textContent.trim();
    }
    if (el.parentElement.tagName.toLowerCase() === 'label') {
        return el.parentElement.textContent.trim();
    }
    if (el.getAttribute('aria-label')) {
        return el.getAttribute('aria-label');
    }
    return null;
}

/**
 * Fills the form fields using a more robust selector.
 * @param {Array<Object>} data - Array of {name, value} objects from the AI.
 * @returns {number} The count of fields successfully filled.
 */
async function fillFormWithData(data) {
    let filledCount = 0;
    console.log("Attempting to fill form with this data:", data);

    for (const item of data) {
        const selector = `[formcontrolname="${item.name}"], [name="${item.name}"], #${item.name}`;
        const element = document.querySelector(selector);
        
        if (element) {
            const tagName = element.tagName.toLowerCase();
            const type = element.type ? element.type.toLowerCase() : '';

            if (tagName === 'select') {
                // Find the option whose text exactly matches the AI's response.
                let optionToSelect = [...element.options].find(opt => opt.text.trim() === item.value);
                if (optionToSelect) {
                    element.value = optionToSelect.value;
                    filledCount++;
                } else {
                    console.warn(`Could not find option "${item.value}" for select element:`, element);
                }
            } else if (type === 'radio') {
                const radioGroup = document.querySelectorAll(`input[type="radio"][name="${item.name}"]`);
                for (let radio of radioGroup) {
                    const label = findLabelForElement(radio);
                    if (label && (label === item.value || label.includes(item.value))) {
                        radio.checked = true;
                        filledCount++;
                        break;
                    }
                }
            } else if (type === 'checkbox') {
                 const truthyValues = ['true', 'yes', 'on', '1'];
                 element.checked = truthyValues.includes(item.value.toLowerCase());
                 filledCount++;
            }
            else { // Standard text inputs, textarea, email, etc.
                element.value = item.value;
                filledCount++;
            }
            triggerChangeEvent(element);
        } else {
             console.warn(`Could not find form element using selector: "${selector}"`);
        }
    }
    return filledCount;
}

/**
 * Dispatches input and change events on an element.
 * This is crucial for forms built with frameworks like React, Vue, or Angular.
 * @param {HTMLElement} element - The element to dispatch events on.
 */
function triggerChangeEvent(element) {
    const eventInput = new Event('input', { bubbles: true, cancelable: true });
    const eventChange = new Event('change', { bubbles: true, cancelable: true });
    element.dispatchEvent(eventInput);
    element.dispatchEvent(eventChange);
}
