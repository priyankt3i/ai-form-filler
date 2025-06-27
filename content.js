console.log("AI Form Filler: content.js script has been injected and is running.");

// Main listener for commands from the popup.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fillForm") {
        console.log("Content script received fillForm command.");
        runFormFillProcess(sendResponse, 3);
        return true; 
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
            const formFields = await scrapeFormFields();
            if (formFields.length === 0) {
                throw new Error("No fillable form fields found on the page.");
            }

            console.log(`Attempt ${attempt}: Requesting data from AI.`);
            console.log(`DEBUG: Sending AI request with these fields:`, JSON.parse(JSON.stringify(formFields)));
            
            const aiResponse = await chrome.runtime.sendMessage({
                action: 'generateFormData',
                fields: formFields,
                attempt: attempt
            });
            
            console.log(`DEBUG: Received AI response:`, JSON.parse(JSON.stringify(aiResponse)));

            if (aiResponse.status === 'error') throw new Error(aiResponse.message);

            const filledCount = await fillFormWithData(aiResponse.data);

            const submitButton = findAndClickSubmitButton();
            if (!submitButton) {
                console.log("No submit button found. Assuming success.");
                sendResponse({ status: "success", fieldsFilled: filledCount, message: "Filled fields, no submit button found." });
                return;
            }

            const errorDetected = await observeForErrors(3000);

            if (errorDetected) {
                console.warn(`Attempt ${attempt} failed. Error detected on page: "${errorDetected}"`);
                if (attempt === maxAttempts) {
                    throw new Error(`Failed after ${maxAttempts} attempts. Last error: ${errorDetected}`);
                }
            } else {
                console.log(`Attempt ${attempt} successful. No errors detected after submission.`);
                sendResponse({ status: "success", fieldsFilled: filledCount, message: `Form submitted successfully after ${attempt} attempt(s).` });
                return; 
            }

        } catch (error) {
            console.error(`Error during form processing (Attempt ${attempt}):`, error);
            if (attempt === maxAttempts) {
                sendResponse({ status: "error", message: error.message });
                return;
            }
        }
    }
}


/**
 * Watches for specific, targeted error messages instead of general text.
 * @param {number} timeout - How long to watch for errors, in milliseconds.
 * @returns {Promise<string|null>} A promise that resolves with the specific error text if found, or null.
 */
function observeForErrors(timeout) {
    return new Promise((resolve) => {
        const errorSelector = '[class*="error"], [class*="invalid"], [class*="alert"], [role="alert"]';

        const checkForError = () => {
            const errorElements = document.querySelectorAll(errorSelector);
            for (const el of errorElements) {
                if (el.offsetParent !== null && el.textContent.trim().length > 0 && el.textContent.trim().length < 100) {
                    return el.textContent.trim();
                }
            }
            return null;
        };
        
        const observer = new MutationObserver(() => {
            const errorText = checkForError();
            if (errorText) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(errorText);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true, attributes: true });

        const timer = setTimeout(() => {
            observer.disconnect();
            const finalErrorText = checkForError();
            resolve(finalErrorText);
        }, timeout);
    });
}

/**
 * Finds and clicks a form's submit button.
 * @returns {HTMLElement|null} The button that was clicked, or null.
 */
function findAndClickSubmitButton() {
    const selectors = [ 'button[type="submit"]', 'button:not([type])', 'input[type="submit"]', '[role="button"]' ];
    const textKeywords = ['continue', 'submit', 'next', 'save', 'update', 'go', 'agree and continue'];

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
 * Waits for an element to appear in the DOM.
 * @param {string} selector - The CSS selector of the element to wait for.
 * @param {number} timeout - The maximum time to wait in milliseconds.
 * @returns {Promise<Element|null>} A promise that resolves with the element or null if timed out.
 */
function waitForElement(selector, timeout = 2000) {
    return new Promise(resolve => {
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Failsafe timeout
        setTimeout(() => {
            observer.disconnect();
            resolve(document.querySelector(selector));
        }, timeout);
    });
}


/**
 * **OVERHAULED**
 * Asynchronously scans for both standard and custom form elements, formatting dropdown options as a string.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of form field objects.
 */
async function scrapeFormFields() {
    const fields = [];
    const elements = document.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, ng-select'
    );
    
    for (const el of elements) {
        if (!el.offsetParent) continue; // Skip hidden elements

        let label = findLabelForElement(el);
        let identifier = el.getAttribute('formcontrolname') || el.name || el.id || (label ? label.replace(/\s+/g, '-').toLowerCase() : null);

        // Skip if no identifier or if a field with this identifier has already been processed as a select type.
        // This prioritizes select/ng-select over other inputs with the same name.
        if (!identifier || fields.some(f => f.name === identifier && f.type === 'select')) {
            continue;
        }

        const tagName = el.tagName.toLowerCase();
        const isSelectLike = tagName === 'select' || tagName === 'ng-select';

        // If an element with this identifier already exists but it's not a select, we replace it with the select version.
        const existingFieldIndex = fields.findIndex(f => f.name === identifier);
        if (isSelectLike && existingFieldIndex > -1) {
             fields.splice(existingFieldIndex, 1);
        } else if (existingFieldIndex > -1) {
            continue; // It's a non-select duplicate, so skip.
        }

        let fieldInfo = {
            name: identifier,
            type: el.type || tagName,
            placeholder: el.placeholder || '',
            label: label || identifier
        };
        
        let optionsArray = [];
        if (tagName === 'select') {
             optionsArray = [...el.options].map(opt => opt.text.trim()).filter(opt => opt && opt.toLowerCase() !== 'select');
        } else if (tagName === 'ng-select') {
            console.log(`Found ng-select component for: ${identifier}. Clicking to get options.`);
            el.click();
            const dropdownPanel = await waitForElement('.ng-dropdown-panel');
            if (dropdownPanel) {
                const optionElements = dropdownPanel.querySelectorAll('.ng-option');
                optionsArray = [...optionElements].map(opt => opt.textContent.trim()).filter(Boolean);
                el.click(); // Click to close
                await new Promise(r => setTimeout(r, 100));
            } else {
                 console.warn(`Could not find dropdown panel for ng-select component: ${identifier}`);
            }
        }

        // If it's a dropdown, format it as requested.
        if (isSelectLike) {
            fieldInfo.type = 'select'; // Use a consistent internal type for our logic
            if (optionsArray.length > 0) {
                // Use the user-requested key for the options string.
                fieldInfo["options available to select"] = optionsArray.join('; ');
            }
        }
        
        fields.push(fieldInfo);
    }
    return fields;
}

/**
 * Tries to find the text label associated with an element using multiple methods.
 * @param {HTMLElement} el - The form element.
 * @returns {string|null} The text of the label, or null if not found.
 */
function findLabelForElement(el) {
    if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label && label.textContent) return label.textContent.trim();
    }
    let parent = el.parentElement;
    while(parent) {
        if (parent.tagName.toLowerCase() === 'label' && parent.textContent) {
            return parent.textContent.trim();
        }
        const containerLabel = parent.querySelector('label');
        if (containerLabel && containerLabel.textContent) return containerLabel.textContent.trim();
        parent = parent.parentElement;
    }
    if (el.getAttribute('aria-label')) {
        return el.getAttribute('aria-label');
    }
    return null;
}


/**
 * Fills the form fields, with robust interaction logic for custom dropdowns.
 * @param {Array<Object>} data - Array of {name, value} objects from the AI.
 * @returns {Promise<number>} A promise that resolves to the count of fields filled.
 */
async function fillFormWithData(data) {
    let filledCount = 0;
    console.log("Attempting to fill form with this data:", data);

    for (const item of data) {
        const selector = `[formcontrolname="${item.name}"], [name="${item.name}"], #${item.name}, ng-select[formcontrolname="${item.name}"]`;
        const element = document.querySelector(selector);
        
        if (element) {
            const tagName = element.tagName.toLowerCase();
            
            if (tagName === 'select') {
                let optionToSelect = [...element.options].find(opt => opt.text.trim().includes(item.value));
                 if (!optionToSelect) { // Fallback if AI value doesn't match
                    console.warn(`Could not find option "${item.value}". Attempting fallback.`);
                    optionToSelect = [...element.options].find(opt => opt.value); // Select first valid option
                }
                if(optionToSelect){
                    element.value = optionToSelect.value;
                    triggerEvent(element, 'change');
                    filledCount++;
                }
            } else if (tagName === 'ng-select') {
                console.log(`Filling ng-select component: ${item.name}`);
                element.click();
                const dropdownPanel = await waitForElement('.ng-dropdown-panel');
                let optionToClick;

                if (dropdownPanel) {
                     optionToClick = [...dropdownPanel.querySelectorAll('.ng-option')].find(opt => opt.textContent.trim().includes(item.value));
                     if (!optionToClick) { // Fallback
                         console.warn(`Could not find option "${item.value}". Attempting fallback.`);
                         optionToClick = dropdownPanel.querySelector('.ng-option');
                     }
                }
                
                if (optionToClick) {
                    optionToClick.click();
                    filledCount++;
                } else {
                    console.warn(`No option found to click. Closing dropdown.`);
                    if (document.querySelector('.ng-dropdown-panel')) {
                        element.click();
                    }
                }
                await new Promise(r => setTimeout(r, 100)); // Wait for close
            }
            else { 
                element.value = item.value;
                triggerEvent(element, 'input');
                triggerEvent(element, 'change');
                triggerEvent(element, 'blur');
                filledCount++;
            }
        } else {
             console.warn(`Could not find form element using selector: "${selector}"`);
        }
    }
    return filledCount;
}

/**
 * Dispatches a specified event on an element.
 * @param {HTMLElement} element - The element to dispatch events on.
 * @param {string} eventName - The name of the event to dispatch (e.g., 'input', 'change', 'click').
 */
function triggerEvent(element, eventName = 'change') {
    const event = new Event(eventName, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
}
